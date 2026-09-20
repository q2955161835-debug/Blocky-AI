use super::BuilderStart;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    io::{BufRead, BufReader, Read, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
        mpsc,
    },
    time::{Duration, Instant},
};
const ERROR: &str = "BLK-BUILDER-PROCESS";
fn assets() -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|_| ERROR)?;
    let directory = exe.parent().ok_or(ERROR)?;
    let mut candidates = vec![directory.join("builder")];
    if directory.file_name().is_some_and(|s| s == "bin")
        && directory
            .parent()
            .and_then(|p| p.file_name())
            .is_some_and(|s| s == "cli")
    {
        candidates.push(
            directory
                .parent()
                .and_then(|p| p.parent())
                .ok_or(ERROR)?
                .join("builder"),
        );
    }
    #[cfg(debug_assertions)]
    candidates.push(Path::new(env!("CARGO_MANIFEST_DIR")).join("../../try/stage5/builder-runtime"));
    candidates
        .into_iter()
        .find(|p| p.join("manifest.json").is_file())
        .ok_or("BLK-BUILDER-RUNTIME".into())
}
fn verify_assets(directory: &Path) -> Result<(), String> {
    let bytes = std::fs::read(directory.join("manifest.json")).map_err(|_| ERROR)?;
    if bytes.len() > 4096 {
        return Err(ERROR.into());
    }
    let manifest = crate::strict_json::parse(&bytes)?;
    let pinned: Value = serde_json::from_str(include_str!(
        "../../../../packages/builder-engine/runtime-lock.json"
    ))
    .map_err(|_| ERROR)?;
    if manifest != pinned {
        return Err("BLK-BUILDER-RUNTIME-HASH".into());
    }
    if manifest["schemaVersion"] != "blocky.builder-runtime/v1"
        || manifest["nodeVersion"] != "22.23.1"
        || manifest["piVersion"] != "0.86.0"
    {
        return Err(ERROR.into());
    }
    for name in ["node.exe", "builder.mjs"] {
        let record = manifest["files"]
            .as_array()
            .and_then(|a| a.iter().find(|v| v["name"] == name))
            .ok_or(ERROR)?;
        let path = directory.join(name);
        if std::fs::symlink_metadata(&path)
            .map_err(|_| ERROR)?
            .file_type()
            .is_symlink()
        {
            return Err(ERROR.into());
        }
        let bytes = std::fs::read(path).map_err(|_| ERROR)?;
        let hash = format!("{:x}", Sha256::digest(&bytes));
        if record["bytes"].as_u64() != Some(bytes.len() as u64) || record["sha256"] != hash {
            return Err(ERROR.into());
        }
        if name == "node.exe"
            && hash != "f8d162c0641dcee512132f3bcf8a68169c7ecb852efd8e1a46c9fec5a0f469ed"
        {
            return Err(ERROR.into());
        }
    }
    Ok(())
}
fn send(pipe: &mut impl Write, id: &str, mut value: Value) -> Result<(), String> {
    value["schemaVersion"] = json!("blocky.builder-ipc/v1");
    value["requestId"] = json!(id);
    pipe.write_all(value.to_string().as_bytes())
        .and_then(|_| pipe.write_all(b"\n"))
        .and_then(|_| pipe.flush())
        .map_err(|_| ERROR.into())
}
pub(super) fn run(
    root: &Path,
    start: &BuilderStart,
    project: Value,
    registry: &Value,
    binding: Option<&crate::provider::ProviderRequest>,
    cancel: &Arc<AtomicBool>,
) -> Result<Value, String> {
    let directory = assets()?.canonicalize().map_err(|_| ERROR)?;
    verify_assets(&directory)?;
    // Node 22's permission/main resolver rejects the Windows verbatim prefix.
    // Canonicalize and verify first, then pass the equivalent drive path.
    #[cfg(windows)]
    let directory = PathBuf::from(
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
        .arg(&script)
        .current_dir(&directory)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    if let Some(value) = std::env::var_os("SystemRoot") {
        command.env("SystemRoot", value);
    }
    #[cfg(test)]
    command.stderr(Stdio::inherit());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000200);
    }
    let mut child = command.spawn().map_err(|_| "BLK-BUILDER-SPAWN")?;
    #[cfg(windows)]
    let job = match crate::process_job::attach(&child) {
        Ok(job) => job,
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
        let mut total = 0usize;
        loop {
            let mut line = Vec::new();
            let read = Read::take(&mut reader, 2 * 1024 * 1024 + 1).read_until(b'\n', &mut line);
            match read {
                Ok(0) | Err(_) => break,
                _ => {}
            }
            total = total.saturating_add(line.len());
            if line.len() > 2 * 1024 * 1024 || total > 8 * 1024 * 1024 || !line.ends_with(b"\n") {
                let _ = tx.send(Err("BLK-BUILDER-BUDGET".to_string()));
                break;
            }
            if tx
                .send(crate::strict_json::parse(&line).map_err(|_| "BLK-BUILDER-WIRE".to_string()))
                .is_err()
            {
                break;
            }
        }
    });
    let id = &start.request.request_id;
    let begin = Instant::now();
    let mut turn = 0u64;
    let mut count = 0usize;
    let result = (|| {
        send(
            &mut stdin,
            id,
            json!({"kind":"start","request":start.request,"project":project,"registry":registry["resources"],"mode":start.mode,"modelId":binding.map(|b|b.model_id.as_str()).unwrap_or("local-builder-v1")}),
        )?;
        loop {
            if cancel.load(Ordering::SeqCst) {
                return Err("BLK-BUILDER-CANCELLED".into());
            }
            if begin.elapsed() > Duration::from_secs(120) {
                cancel.store(true, Ordering::SeqCst);
                return Err("BLK-BUILDER-TIMEOUT".into());
            }
            let frame = match rx.recv_timeout(Duration::from_millis(20)) {
                Ok(v) => v?,
                Err(mpsc::RecvTimeoutError::Timeout) => continue,
                Err(_) => return Err("BLK-BUILDER-EXIT".into()),
            };
            count += 1;
            if count > 128
                || frame["schemaVersion"] != "blocky.builder-ipc/v1"
                || frame["requestId"] != *id
            {
                return Err("BLK-BUILDER-WIRE".into());
            }
            match frame["kind"].as_str() {
                Some("provider.call") => {
                    if frame.as_object().ok_or(ERROR)?.keys().any(|k| {
                        !["schemaVersion", "requestId", "kind", "turn", "messages"]
                            .contains(&k.as_str())
                    }) {
                        return Err("BLK-BUILDER-WIRE".into());
                    }
                    turn += 1;
                    if frame["turn"].as_u64() != Some(turn)
                        || turn > start.max_turns as u64
                        || binding.is_none()
                    {
                        return Err("BLK-BUILDER-BUDGET".into());
                    }
                    let remaining = 120000u64.saturating_sub(begin.elapsed().as_millis() as u64);
                    if remaining == 0 {
                        return Err("BLK-BUILDER-TIMEOUT".into());
                    }
                    let mut bounded = binding.unwrap().clone();
                    bounded.timeout_ms = bounded.timeout_ms.min(remaining);
                    let value = crate::provider::builder::generate(
                        root,
                        &bounded,
                        frame["messages"].clone(),
                        cancel,
                    )?;
                    send(
                        &mut stdin,
                        id,
                        json!({"kind":"provider.result","turn":turn,"value":value}),
                    )?;
                }
                Some("event") => {
                    if frame.as_object().ok_or(ERROR)?.keys().any(|k| {
                        !["schemaVersion", "requestId", "kind", "event"].contains(&k.as_str())
                    }) {
                        return Err("BLK-BUILDER-WIRE".into());
                    }
                }
                Some("complete") => {
                    if frame.as_object().ok_or(ERROR)?.keys().any(|k| {
                        !["schemaVersion", "requestId", "kind", "result"].contains(&k.as_str())
                    }) {
                        return Err("BLK-BUILDER-WIRE".into());
                    }
                    return Ok(frame["result"].clone());
                }
                Some("error") => {
                    let code = frame["code"]
                        .as_str()
                        .filter(|c| {
                            c.starts_with("BLK-")
                                && c.len() < 80
                                && c.bytes().all(|b| {
                                    b.is_ascii_uppercase() || b.is_ascii_digit() || b == b'-'
                                })
                        })
                        .unwrap_or(ERROR);
                    return Err(code.into());
                }
                _ => return Err("BLK-BUILDER-WIRE".into()),
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
        return Err("BLK-BUILDER-SETTLE".into());
    }
    result
}
