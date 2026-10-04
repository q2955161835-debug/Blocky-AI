use super::{
    CodingHost, CodingStart,
    cli::Cli,
    files::{Scope, digest},
};
use crate::provider::builder_model::BuilderModel;
use serde_json::{Value, json};
use std::{
    collections::HashSet,
    io::{BufRead, BufReader, Read, Write},
    path::Path,
    process::{Command, Stdio},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
        mpsc,
    },
    time::{Duration, Instant},
};
const ERROR: &str = "BLK-CODING-WIRE";
fn send(pipe: &mut impl Write, id: &str, mut value: Value) -> Result<(), String> {
    value["schemaVersion"] = json!("blocky.coding-ipc/v1");
    value["requestId"] = json!(id);
    let bytes = value.to_string();
    if bytes.len() > 16 * 1024 * 1024 { return Err("BLK-CODING-BUDGET".into()); }
    pipe.write_all(bytes.as_bytes())
        .and_then(|_| pipe.write_all(b"\n"))
        .and_then(|_| pipe.flush())
        .map_err(|_| ERROR.into())
}
fn keys(frame: &Value, allowed: &[&str]) -> Result<(), String> {
    if frame.as_object().is_none_or(|o| {
        o.keys().any(|k| {
            !["schemaVersion", "requestId", "kind"].contains(&k.as_str())
                && !allowed.contains(&k.as_str())
        })
    }) {
        return Err(ERROR.into());
    }
    Ok(())
}
pub(super) fn bounded_text(value: &Value, max: usize) -> Result<&str, String> {
    value
        .as_str()
        .filter(|s| s.encode_utf16().count() <= max)
        .ok_or(ERROR.into())
}
pub(super) fn run(
    host: &CodingHost,
    root: &Path,
    start: &CodingStart,
    project: Value,
    scope: Option<&Scope>,
    binding: &BuilderModel,
    cancel: &Arc<AtomicBool>,
    on_event: &mut dyn FnMut(Value) -> Result<(), String>,
) -> Result<Value, String> {
    let mut cli = Cli::new(root, start, project.clone())?;
    let directory = crate::builder::process::assets()?
        .canonicalize()
        .map_err(|_| ERROR)?;
    crate::builder::process::verify_assets(&directory)?;
    #[cfg(windows)]
    let directory = std::path::PathBuf::from(
        directory
            .to_string_lossy()
            .strip_prefix("\\\\?\\")
            .ok_or(ERROR)?,
    );
    let script = directory.join("builder.mjs");
    let mut command = Command::new(directory.join("node.exe"));
    command
        .env_clear()
        .args(["--permission", "--no-addons"])
        .arg(format!("--allow-fs-read={}", script.display()))
        .arg(script)
        .current_dir(&directory)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    if let Some(value) = std::env::var_os("SystemRoot") {
        command.env("SystemRoot", value);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000200);
    }
    let mut child = command.spawn().map_err(|_| "BLK-CODING-SPAWN")?;
    #[cfg(windows)]
    let job = match crate::process_job::attach(&child) {
        Ok(j) => j,
        Err(e) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err(e);
        }
    };
    let mut stdin = child.stdin.take().ok_or(ERROR)?;
    let stdout = child.stdout.take().ok_or(ERROR)?;
    let (tx, rx) = mpsc::sync_channel(8);
    let reader = std::thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        let mut total = 0;
        loop {
            let mut line = Vec::new();
            match Read::take(&mut reader, 16 * 1024 * 1024 + 1).read_until(b'\n', &mut line) {
                Ok(0) | Err(_) => break,
                _ => {}
            }
            total += line.len();
            if line.len() > 16 * 1024 * 1024 || total > 64 * 1024 * 1024 || !line.ends_with(b"\n") {
                let _ = tx.send(Err("BLK-CODING-BUDGET".to_owned()));
                break;
            }
            if tx
                .send(crate::strict_json::parse(&line).map_err(|_| ERROR.to_owned()))
                .is_err()
            {
                break;
            }
        }
    });
    let began = Instant::now();
    let id = &start.request_id;
    let mut turn = 0;
    let mut sequence = 0;
    let mut count = 0;
    let mut used = HashSet::new();
    let mut changes = Vec::new();
    let mut events = Vec::new();
    let mut generations = Vec::new();
    let mut network = false;
    let result = (|| {
        send(
            &mut stdin,
            id,
            json!({"kind":"start","start":start,"modelId":binding.model()}),
        )?;
        loop {
            if cancel.load(Ordering::SeqCst) {
                return Err("BLK-CODING-CANCELLED".into());
            }
            if began.elapsed() > Duration::from_secs(86400) {
                return Err("BLK-CODING-TIMEOUT".into());
            }
            let frame = match rx.recv_timeout(Duration::from_millis(20)) {
                Ok(v) => v?,
                Err(mpsc::RecvTimeoutError::Timeout) => continue,
                Err(_) => return Err("BLK-CODING-EXIT".into()),
            };
            count += 1;
            if count > 262144
                || frame["schemaVersion"] != "blocky.coding-ipc/v1"
                || frame["requestId"] != *id
            {
                return Err(ERROR.into());
            }
            match frame["kind"].as_str() {
                Some("provider.call") => {
                    keys(&frame, &["turn", "messages"])?;
                    turn += 1;
                    if turn > 4096 || frame["turn"].as_u64() != Some(turn) {
                        return Err("BLK-CODING-BUDGET".into());
                    }
                    let remaining = 86400000u64.saturating_sub(began.elapsed().as_millis() as u64);
                    let mut metadata = None;
                    if crate::builder::contains_credentials(&frame["messages"]) {
                        return Err("BLK-CODING-INPUT".into());
                    }
                    let generated = binding.generate(
                        root,
                        frame["messages"].clone(),
                        remaining,
                        cancel,
                        &mut metadata,
                        &mut || {
                            network = true;
                            if !["ollama", "managed-local"].contains(&binding.provider()) {
                                host.note_external_call(id)?;
                            }
                            Ok(())
                        },
                    );
                    match generated {
                        Ok(value) => {
                            let mut generation = value.clone();
                            generation.as_object_mut().ok_or(ERROR)?.remove("content");
                            // Keep only actual response metadata in the public receipt.
                            let allowed = [
                                "schemaVersion",
                                "usageStatus",
                                "localInference",
                                "externalApi",
                                "provider",
                                "model",
                                "requestId",
                                "transport",
                                "usage",
                            ];
                            generation
                                .as_object_mut()
                                .ok_or(ERROR)?
                                .retain(|k, _| allowed.contains(&k.as_str()));
                            generations.push(generation);
                            send(
                                &mut stdin,
                                id,
                                json!({"kind":"provider.result","turn":turn,"value":value}),
                            )?;
                        }
                        Err(code) => return Err(code),
                    }
                }
                Some("tool.call") => {
                    keys(&frame, &["callId", "name", "args"])?;
                    let call = frame["callId"]
                        .as_str()
                        .filter(|c| {
                            !c.is_empty()
                                && c.len() <= 128
                                && c.bytes()
                                    .all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b))
                        })
                        .ok_or(ERROR)?;
                    let name = frame["name"]
                        .as_str()
                        .filter(|n| super::TOOLS.contains(n))
                        .ok_or(ERROR)?;
                    if !used.insert(call.to_owned()) || used.len() > 65536 {
                        return Err(ERROR.into());
                    }
                    let value = host.tool(start, scope, &mut cli, name, &frame["args"], cancel);
                    if cancel.load(Ordering::SeqCst) {
                        return Err("BLK-CODING-CANCELLED".into());
                    }
                    match value {
                        Ok(result) => {
                            if let Some(change) = result.get("change") {
                                changes.push(change.clone());
                            }
                            send(
                                &mut stdin,
                                id,
                                json!({"kind":"tool.result","callId":call,"ok":true,"result":result}),
                            )?;
                        }
                        Err(code) => send(
                            &mut stdin,
                            id,
                            json!({"kind":"tool.result","callId":call,"ok":false,"code":code}),
                        )?,
                    }
                }
                Some("event") => {
                    keys(&frame, &["event"])?;
                    let event = &frame["event"];
                    let fields = [
                        "schemaVersion",
                        "requestId",
                        "projectId",
                        "sequence",
                        "kind",
                        "tool",
                        "callId",
                        "text",
                        "code",
                        "change",
                    ];
                    if event
                        .as_object()
                        .is_none_or(|e| e.keys().any(|k| !fields.contains(&k.as_str())))
                        || event["schemaVersion"] != "blocky.coding-event/v1"
                        || event["requestId"] != *id
                        || event["projectId"] != start.project_id
                        || event["sequence"].as_u64() != Some(sequence + 1)
                        || events.len() >= 262144
                        || crate::builder::contains_credentials(event)
                    {
                        return Err(ERROR.into());
                    }
                    if let Some(tool) = event.get("tool") {
                        if tool.as_str().is_none_or(|t| !super::TOOLS.contains(&t)) {
                            return Err(ERROR.into());
                        }
                    }
                    if let Some(text) = event.get("text") {
                        bounded_text(text, 16384)?;
                    }
                    match event["kind"].as_str() {
                        Some("text.delta" | "tool.started" | "tool.completed" | "tool.failed") => {}
                        Some("file.changed") => {
                            if !changes.contains(&event["change"]) {
                                return Err(ERROR.into());
                            }
                        }
                        _ => return Err(ERROR.into()),
                    }
                    sequence += 1;
                    on_event(event.clone())?;
                    events.push(event.clone());
                }
                Some("complete") => {
                    keys(&frame, &["result"])?;
                    let mut result = frame["result"].clone();
                    let fields = [
                        "schemaVersion",
                        "requestId",
                        "projectId",
                        "baseDigest",
                        "text",
                        "changes",
                        "events",
                        "generations",
                        "engine",
                        "modelApiCalled",
                        "project",
                    ];
                    if result
                        .as_object()
                        .is_none_or(|o| o.keys().any(|k| !fields.contains(&k.as_str())))
                        || result["schemaVersion"] != "blocky.coding-result/v1"
                        || result["requestId"] != *id
                        || result["projectId"] != start.project_id
                        || result["baseDigest"] != digest(&start.original_json)
                        || result["text"].as_str().is_none_or(|text| text.len() > 2 * 1024 * 1024)
                        || crate::builder::contains_credentials(&result["text"])
                    {
                        return Err(ERROR.into());
                    }
                    result["changes"] = json!(changes);
                    result["events"] = json!(events);
                    result["generations"] = json!(generations);
                    result["modelApiCalled"] = json!(
                        network
                            && binding.provider() != "ollama"
                            && binding.provider() != "managed-local"
                    );
                    result.as_object_mut().ok_or(ERROR)?.remove("project");
                    if cli.project != project {
                        crate::patch_guard::project_files(&cli.project)?;
                        result["project"] = cli.project.clone();
                    }
                    return Ok(result);
                }
                Some("error") => {
                    keys(&frame, &["code"])?;
                    return Err(frame["code"]
                        .as_str()
                        .filter(|s| {
                            s.len() < 100
                                && s.starts_with("BLK-")
                                && s.bytes().all(|b| {
                                    b.is_ascii_uppercase() || b.is_ascii_digit() || b == b'-'
                                })
                        })
                        .unwrap_or(ERROR)
                        .to_owned());
                }
                _ => return Err(ERROR.into()),
            }
        }
    })();
    drop(stdin);
    drop(rx);
    #[cfg(windows)]
    let settled = job.settle();
    #[cfg(not(windows))]
    let settled = child.kill().is_ok();
    let waited = child.wait().is_ok();
    let joined = reader.join().is_ok();
    if !settled || !waited || !joined {
        return Err("BLK-CODING-SETTLE".into());
    }
    result
}
