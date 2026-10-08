use super::{CodingStart, files::Scope};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    io::Read,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::atomic::{AtomicBool, Ordering},
    time::{Duration, Instant},
};
const ERROR: &str = "BLK-CODING-CLI";
pub(super) struct Cli {
    staging: tempfile::TempDir,
    pub project: Value,
    revision: u32,
    profile: PathBuf,
    patch: Option<PathBuf>,
}
impl Cli {
    pub fn new(root: &Path, start: &CodingStart, project: Value) -> Result<Self, String> {
        let staging = tempfile::tempdir().map_err(|_| ERROR)?;
        crate::project_store::create_archive(
            &staging.path().join("project-0.blocky"),
            &crate::patch_guard::project_files(&project)?,
        )?;
        let _ = start;
        Ok(Self {
            staging,
            project,
            revision: 0,
            profile: root.to_path_buf(),
            patch: None,
        })
    }
    pub fn run(
        &mut self,
        args: &[String],
        scope: Option<&Scope>,
        cancel: &AtomicBool,
    ) -> Result<Value, String> {
        // This tool always uses structured JSON output. Normalize the optional
        // public CLI flag here instead of relying on model spelling each time.
        let mut args = args.to_vec();
        if !args.iter().any(|arg| arg == "--json") {
            args.push("--json".into());
        }
        let prepared = prepare(&args).map_err(|_| "BLK-CODING-CLI-ARGS")?;
        let mut input = 0;
        for index in prepared.inputs {
            if args[index] == "$project" {
                args[index] = self
                    .staging
                    .path()
                    .join(format!("project-{}.blocky", self.revision))
                    .to_string_lossy()
                    .into_owned();
            } else if args[index] == "$patch" {
                args[index] = self.patch.as_ref().ok_or("BLK-CODING-CLI-ARTIFACT")?
                    .to_string_lossy().into_owned();
            } else {
                let path = &args[index];
                let content = if let Some(inline) = path.strip_prefix("$json:") {
                    if inline.len() > 256 * 1024 {
                        return Err("BLK-CODING-BUDGET".into());
                    }
                    let value = crate::strict_json::parse(inline.as_bytes())
                        .map_err(|_| "BLK-CODING-CLI-JSON")?;
                    if !value.is_object() && !value.is_array() {
                        return Err("BLK-CODING-CLI-JSON-ROOT".into());
                    }
                    if crate::builder::contains_credentials(&value) {
                        return Err("BLK-CODING-CLI-INPUT-GUARD".into());
                    }
                    crate::project_store::check_secrets(&value, 0)
                        .map_err(|_| "BLK-CODING-CLI-INPUT-GUARD")?;
                    value.to_string()
                } else {
                    let read = scope.ok_or("BLK-CODING-WORKSPACE")?.read(path)?;
                    read["text"].as_str().ok_or(ERROR)?.to_owned()
                };
                let target = self.staging.path().join(format!("input-{input}.json"));
                input += 1;
                std::fs::write(&target, content).map_err(|_| ERROR)?;
                args[index] = target.to_string_lossy().into_owned();
            }
        }
        let mut next = None;
        let mut next_patch = None;
        if let Some(i) = prepared.output {
            if prepared.patch_output {
                if args[i] != "$patch" { return Err("BLK-CODING-CLI-ARGS".into()); }
                let path = self.staging.path().join(format!("patch-{}.json", uuid::Uuid::new_v4()));
                args[i] = path.to_string_lossy().into_owned();
                next_patch = Some(path);
            } else if args[i] != "$project" {
                return Err("BLK-CODING-CLI-ARGS".into());
            } else if prepared.modifies {
                let path = self
                    .staging
                    .path()
                    .join(format!("project-{}.blocky", self.revision + 1));
                args[i] = path.to_string_lossy().into_owned();
                next = Some(path);
            } else {
                return Err(ERROR.into());
            }
        }
        if cancel.load(Ordering::SeqCst) {
            return Err("BLK-CODING-CANCELLED".into());
        }
        let (node, script) = assets()?;
        let mut command = Command::new(node);
        command
            .arg(script)
            .args(args)
            .current_dir(self.staging.path())
            .env_clear()
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        command.env(crate::profile::VARIABLE, &self.profile);
        for key in ["SystemRoot"] {
            if let Some(value) = std::env::var_os(key) {
                command.env(key, value);
            }
        }
        // Profile is passed by CodingHost, not inherited from untrusted tool arguments.
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000200);
        }
        let mut child = command.spawn().map_err(|_| ERROR)?;
        #[cfg(windows)]
        let job = match crate::process_job::attach(&child) {
            Ok(j) => j,
            Err(e) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(e);
            }
        };
        let stdout = child.stdout.take().ok_or(ERROR)?;
        let stderr = child.stderr.take().ok_or(ERROR)?;
        let out = std::thread::spawn(move || bounded(stdout));
        let err = std::thread::spawn(move || bounded(stderr));
        let began = Instant::now();
        let status = loop {
            if cancel.load(Ordering::SeqCst) || began.elapsed() > Duration::from_secs(30) {
                break Err(if cancel.load(Ordering::SeqCst) {
                    "BLK-CODING-CANCELLED"
                } else {
                    "BLK-CODING-TIMEOUT"
                }
                .to_owned());
            }
            match child.try_wait() {
                Ok(Some(s)) => break Ok(s),
                Ok(None) => std::thread::sleep(Duration::from_millis(20)),
                Err(_) => break Err(ERROR.into()),
            }
        };
        #[cfg(windows)]
        let settled = job.settle();
        #[cfg(not(windows))]
        let settled = status.is_ok() || child.kill().is_ok();
        let waited = child.wait().is_ok();
        let output = out.join().map_err(|_| ERROR)?;
        let errors = err.join().map_err(|_| ERROR)?;
        if !settled || !waited {
            return Err("BLK-CODING-SETTLE".into());
        }
        let status = status?;
        let output = output?;
        let errors = errors?;
        let safe = safe_cli_output(&output, !errors.trim().is_empty(), status.success())?;
        if status.success() {
            if let Some(path) = next_patch {
                if std::fs::metadata(&path).map_err(|_| ERROR)?.len() > 2 * 1024 * 1024 {
                    return Err("BLK-CODING-BUDGET".into());
                }
                let patch = crate::strict_json::parse(&std::fs::read(&path).map_err(|_| ERROR)?)?;
                crate::project_store::check_secrets(&patch, 0).map_err(|_| ERROR)?;
                self.patch = Some(path);
            }
            if let Some(path) = next {
                let project = decode(&crate::project_store::read_archive(&path)?)?;
                if project["manifest"]["projectId"] != self.project["manifest"]["projectId"] {
                    return Err(ERROR.into());
                }
                self.project = project;
                self.revision += 1;
            }
        }
        Ok(json!({"exitCode":status.code().unwrap_or(-1),"output":safe}))
    }
}
fn safe_cli_output(output: &str, has_stderr: bool, succeeded: bool) -> Result<Value, String> {
    // stderr is never returned. A normal CLI rejection writes the same public
    // error to stderr and an already-redacted structured envelope to stdout.
    let frames = output
        .lines()
        .map(|line| crate::strict_json::parse(line.as_bytes()).map_err(|_| ERROR.to_owned()))
        .collect::<Result<Vec<Value>, _>>()?;
    let trusted_failure = !succeeded
        && frames.len() == 1
        && frames[0]["schemaVersion"] == "blocky.cli/v1"
        && frames[0]["ok"] == false
        && frames[0]["error"]["code"].as_str().is_some_and(|code| {
            code.starts_with("BLK-")
                && code.len() > 4
                && code.len() <= 128
                && code
                    .bytes()
                    .all(|byte| byte.is_ascii_uppercase() || byte.is_ascii_digit() || byte == b'-')
        });
    let safe = serde_json::to_value(frames).map_err(|_| ERROR)?;
    if crate::builder::contains_credentials(&safe) || (has_stderr && !trusted_failure) {
        return Err(ERROR.into());
    }
    Ok(safe)
}
fn bounded(mut pipe: impl Read) -> Result<String, String> {
    let mut out = Vec::new();
    let mut buffer = [0u8; 8192];
    let mut overflow = false;
    loop {
        let n = pipe.read(&mut buffer).map_err(|_| ERROR)?;
        if n == 0 {
            break;
        }
        if out.len() + n > 2 * 1024 * 1024 {
            overflow = true;
        } else if !overflow {
            out.extend_from_slice(&buffer[..n]);
        }
    }
    if overflow {
        return Err("BLK-CODING-BUDGET".into());
    }
    String::from_utf8(out).map_err(|_| ERROR.into())
}
struct Prepared {
    inputs: Vec<usize>,
    output: Option<usize>,
    modifies: bool,
    patch_output: bool,
}
fn prepare(args: &[String]) -> Result<Prepared, String> {
    if args.len() < 2
        || args.len() > 64
        || args
            .iter()
            .any(|a| a.is_empty() || a.len() > 256 * 1024 + 6 || a.chars().any(|c| c.is_control() && !(a.starts_with("$json:") && matches!(c, '\n' | '\r' | '\t'))))
    {
        return Err(ERROR.into());
    }
    if args == ["--version".to_owned(), "--json".to_owned()] {
        return Ok(Prepared {
            inputs: Vec::new(),
            output: None,
            modifies: false,
            patch_output: false,
        });
    }
    let command = format!("{}.{}", args[0], args[1]);
    let patch_output = command == "patch.create";
    let (positional, keys, modifies): (usize, &[&str], bool) = match command.as_str() {
        "catalog.list" => (0, &["limit", "cursor"], false),
        "command.list" => (0, &["query"], false),
        "catalog.show" | "schema.show" => (1, &[], false),
        "schema.list" => (0, &[], false),
        "project.inspect" | "project.validate" | "project.compile" | "project.map"
        | "surface.list" | "run.preflight" => (1, &[], false),
        "project.configure" => (1, &["module", "block", "field", "value", "output"], true),
        "project.edit" => (1, &["operations", "expect-digest", "output"], true),
        "patch.preview" => (1, &["patch"], false),
        "patch.create" => (1, &["operations", "output"], false),
        "patch.apply" => (1, &["patch", "approve-permissions", "output"], true),
        _ => return Err(ERROR.into()),
    };
    let mut inputs = Vec::new();
    let mut output = None;
    let mut seen = std::collections::BTreeSet::new();
    let mut words = 0;
    let mut i = 2;
    while i < args.len() {
        let arg = &args[i];
        if let Some(key) = arg.strip_prefix("--") {
            if !seen.insert(key) {
                return Err(ERROR.into());
            }
            if key == "json" {
                i += 1;
                continue;
            }
            if !keys.contains(&key) || i + 1 >= args.len() || args[i + 1].starts_with('-') {
                return Err(ERROR.into());
            }
            if ["patch", "operations"].contains(&key) {
                inputs.push(i + 1);
            }
            if key == "output" {
                output = Some(i + 1);
            }
            i += 2;
        } else {
            if arg.starts_with('-') {
                return Err(ERROR.into());
            }
            words += 1;
            if command.starts_with("project.")
                || command.starts_with("patch.")
                || command == "surface.list"
                || command == "run.preflight"
            {
                if arg != "$project" {
                    return Err(ERROR.into());
                }
                inputs.push(i);
            }
            i += 1;
        }
    }
    if words != positional || !seen.contains("json") || (modifies || patch_output) != output.is_some() {
        return Err(ERROR.into());
    }
    Ok(Prepared {
        inputs,
        output,
        modifies,
        patch_output,
    })
}
pub(super) fn assets() -> Result<(PathBuf, PathBuf), String> {
    let directory = crate::builder::process::assets()?
        .canonicalize()
        .map_err(|_| ERROR)?;
    crate::builder::process::verify_assets(&directory)?;
    let executable = std::env::current_exe().map_err(|_| ERROR)?;
    let parent = executable.parent().ok_or(ERROR)?;
    let mut candidates = vec![
        parent.join("cli/main.mjs"),
        parent.parent().ok_or(ERROR)?.join("main.mjs"),
    ];
    #[cfg(debug_assertions)]
    candidates
        .push(Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tools/blocky-cli/dist/main.mjs"));
    let script = candidates.into_iter().find(|p| p.is_file()).ok_or(ERROR)?;
    let lock: Value = serde_json::from_str(include_str!(
        "../../../../tools/blocky-cli/cli-runtime-lock.json"
    ))
    .map_err(|_| ERROR)?;
    let meta = std::fs::symlink_metadata(&script).map_err(|_| ERROR)?;
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if meta.file_attributes() & 0x400 != 0 {
            return Err(ERROR.into());
        }
    }
    if meta.file_type().is_symlink() || meta.len() > 16 * 1024 * 1024 {
        return Err(ERROR.into());
    }
    let bytes = std::fs::read(&script).map_err(|_| ERROR)?;
    if lock["bytes"].as_u64() != Some(bytes.len() as u64)
        || lock["sha256"] != format!("{:x}", Sha256::digest(bytes))
    {
        return Err("BLK-CODING-CLI-HASH".into());
    }
    Ok((directory.join("node.exe"), script))
}
pub(super) fn decode(files: &BTreeMap<String, String>) -> Result<Value, String> {
    let manifest = crate::strict_json::parse(files.get("project.json").ok_or(ERROR)?.as_bytes())?;
    let mut p =
        json!({"manifest":manifest,"workspaces":{},"resources":{},"schemas":{},"surfaces":{}});
    for module in p["manifest"]["modules"].as_array().ok_or(ERROR)?.clone() {
        let id = module["moduleId"].as_str().ok_or(ERROR)?;
        let path = module["workspaceRef"].as_str().ok_or(ERROR)?;
        p["workspaces"][id] = crate::strict_json::parse(files.get(path).ok_or(ERROR)?.as_bytes())?;
    }
    for resource in p["manifest"]["resources"].as_array().ok_or(ERROR)?.clone() {
        if resource["scope"] == "project" {
            let id = resource["resourceId"].as_str().ok_or(ERROR)?;
            let path = resource["definitionRef"].as_str().ok_or(ERROR)?;
            p["resources"][id] =
                crate::strict_json::parse(files.get(path).ok_or(ERROR)?.as_bytes())?;
        }
    }
    for (path, text) in files {
        if path.starts_with("schemas/") {
            p["schemas"][path] = crate::strict_json::parse(text.as_bytes())?;
        }
        if path.starts_with("surfaces/") {
            p["surfaces"][path] = if path.ends_with(".json") {
                crate::strict_json::parse(text.as_bytes())?
            } else {
                json!(text)
            };
        }
        if path == "settings.json" {
            p["settings"] = crate::strict_json::parse(text.as_bytes())?;
        }
    }
    crate::patch_guard::project_files(&p)?;
    Ok(p)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn structured_failure_keeps_safe_diagnostics_without_forwarding_process_stderr() {
        let frame = json!({"schemaVersion":"blocky.cli/v1","ok":false,"error":{"code":"BLK-PATCH-004"},"data":{"diagnostics":[{"code":"BLK-TYPE-009","message":"JSON required"}]}});
        assert_eq!(
            safe_cli_output(&frame.to_string(), true, false).unwrap(),
            json!([frame])
        );
        assert!(safe_cli_output(&frame.to_string(), true, true).is_err());
        assert!(safe_cli_output("", true, false).is_err());
        assert!(safe_cli_output("native process diagnostic", true, false).is_err());
        let mut invalid = frame.clone();
        invalid["schemaVersion"] = json!("unknown/v1");
        assert!(safe_cli_output(&invalid.to_string(), true, false).is_err());
        invalid = frame.clone();
        invalid["error"]["code"] = json!("private lowercase diagnostic");
        assert!(safe_cli_output(&invalid.to_string(), true, false).is_err());
        invalid = frame.clone();
        invalid["data"]["apiKey"] = json!(format!("sk-{}", "a".repeat(32)));
        assert!(safe_cli_output(&invalid.to_string(), true, false).is_err());
    }
    #[test]
    fn patch_creation_uses_isolated_artifact_output_without_workspace_access() {
        let args = ["patch", "create", "$project", "--operations", "$json:[]", "--output", "$patch", "--json"].map(str::to_owned);
        let prepared = prepare(&args).unwrap();
        assert!(prepared.patch_output && !prepared.modifies);
        let mut pretty = args.clone();
        pretty[4] = "$json:\n[\n]\n".into();
        assert!(prepare(&pretty).is_ok());
        pretty[4] = "$json:[\u{0000}]".into();
        assert!(prepare(&pretty).is_err());
    }
    #[test]
    fn cli_is_closed_and_paths_cannot_escape() {
        assert!(prepare(&["project", "inspect", "$project", "--json"].map(str::to_owned)).is_ok());
        for args in [
            vec!["builder", "draft", "$project", "--json"],
            vec!["template", "list", "--json"],
            vec!["template", "show", "research-companion", "--json"],
            vec!["blueprint", "official", "research-companion", "--json"],
            vec!["run", "start", "$project", "--live", "--json"],
            vec!["project", "inspect", "C:/secret.blocky", "--json"],
            vec!["schema", "list", "--json", "--output", "escape"],
            vec![
                "project",
                "edit",
                "$project",
                "--operations",
                "ok.json",
                "--output",
                "other.blocky",
                "--json",
            ],
        ] {
            let p = prepare(&args.iter().map(|s| s.to_string()).collect::<Vec<_>>());
            if args[1] == "edit" {
                assert!(p.is_ok());
            } else {
                assert!(p.is_err());
            }
        }
    }
    fn isolated_cli() -> Cli {
        let base=Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap().parent().unwrap().join("try");
        std::fs::create_dir_all(&base).unwrap();
        let staging=tempfile::Builder::new().prefix("coding-cli-patch-").tempdir_in(base).unwrap();
        let project=json!({"manifest":{"schemaVersion":"blocky.project/v1","projectId":"cli-empty","displayName":"Empty regression","modules":[{"moduleId":"main","displayName":"Main","purpose":"general","workspaceRef":"workspaces/main.workspace.json","exports":[]}],"resources":[],"appSurfaces":[],"format":{"createdWith":"blocky-desktop/0.8.0","minimumReaderVersion":"0.2.0"}},"workspaces":{"main":{"blocks":{"languageVersion":0,"blocks":[]}}},"resources":{},"schemas":{},"surfaces":{}});
        crate::project_store::create_archive(&staging.path().join("project-0.blocky"),&crate::patch_guard::project_files(&project).unwrap()).unwrap();
        let profile=staging.path().join("profile");
        Cli {staging,project,revision:0,profile,patch:None}
    }
    #[test]
    fn inline_rejections_identify_the_safe_stage_without_writing_or_changing_project() {
        let mut cli = isolated_cli();
        let original = cli.project.clone();
        let archive = std::fs::read(cli.staging.path().join("project-0.blocky")).unwrap();
        let credential = json!({"value": format!("sk-{}", "a".repeat(32))}).to_string();
        let mut nested = json!(0);
        for _ in 0..101 { nested = json!({"nested":nested}); }
        for (inline, code) in [
            ("[".to_owned(), "BLK-CODING-CLI-JSON"),
            (r#"{"x":1,"x":2}"#.to_owned(), "BLK-CODING-CLI-JSON"),
            (r#"{"a":{"x":1,"x":2}}"#.to_owned(), "BLK-CODING-CLI-JSON"),
            (r#""[]""#.to_owned(), "BLK-CODING-CLI-JSON-ROOT"),
            ("42".to_owned(), "BLK-CODING-CLI-JSON-ROOT"),
            (r#"{"password":"synthetic"}"#.to_owned(), "BLK-CODING-CLI-INPUT-GUARD"),
            (credential, "BLK-CODING-CLI-INPUT-GUARD"),
            (nested.to_string(), "BLK-CODING-CLI-INPUT-GUARD"),
        ] {
            let args = ["patch", "create", "$project", "--operations"]
                .map(str::to_owned)
                .into_iter()
                .chain([format!("$json:{inline}"), "--output".into(), "$patch".into()])
                .collect::<Vec<_>>();
            assert_eq!(cli.run(&args, None, &AtomicBool::new(false)).unwrap_err(), code);
            assert_eq!(cli.project, original);
            assert_eq!(cli.revision, 0);
            assert!(cli.patch.is_none());
            assert!(!cli.staging.path().join("input-0.json").exists());
            assert_eq!(std::fs::read(cli.staging.path().join("project-0.blocky")).unwrap(), archive);
        }
    }
    fn invoke(cli:&mut Cli,args:Vec<String>)->Result<Value,String> {
        let label=args.iter().take(2).cloned().collect::<Vec<_>>().join(" ");
        cli.run(&args,None,&AtomicBool::new(false)).map_err(|code|format!("{label}: {code}"))
    }
    fn succeeded(result:Result<Value,String>)->Value {
        let value=result.expect("Real pinned CLI must execute; missing or stale bundle is a test failure");
        assert_eq!(value["exitCode"],0,"{value}");value
    }
    fn rejected_without_change(cli:&mut Cli,args:Vec<String>) {
        let before=cli.project.clone();let revision=cli.revision;
        let archive=std::fs::read(cli.staging.path().join(format!("project-{revision}.blocky"))).unwrap();
        if let Ok(value)=invoke(cli,args) {assert_ne!(value["exitCode"],0,"Unexpected accepted command: {value}");}
        assert_eq!(cli.project,before);assert_eq!(cli.revision,revision);
        assert_eq!(std::fs::read(cli.staging.path().join(format!("project-{revision}.blocky"))).unwrap(),archive);
    }
    #[test]
    fn actual_cli_patch_create_preview_apply_compile_without_workspace_is_atomic() {
        assets().expect("Run the existing project CLI build/install before this regression; never skip missing assets");
        let mut cli=isolated_cli();let original=cli.project.clone();
        let text=json!({"type":"core.data.literal","id":"reply-text","fields":{"VALUE":"\"Fixed answer\""}});
        let message=json!({"type":"core.message.create","id":"reply-message","inputs":{"CONTENT":{"block":text}}});
        let reply=json!({"type":"core.message.reply","id":"fixed-reply","inputs":{"MESSAGE":{"block":message}}});
        let set=json!({"type":"core.data.set","id":"set-result","fields":{"VALUE":"\"fixed\""}});
        let repeat=json!({"type":"core.flow.repeat","id":"repeat-three","fields":{"COUNT":"3"},"inputs":{"DO":{"block":set}},"next":{"block":reply}});
        let condition=json!({"type":"core.logic.condition","id":"conditional","fields":{"SOURCE":"input","OP":"equals","VALUE":"go"},"inputs":{"THEN":{"block":repeat}}});
        let entry=json!({"type":"core.interaction.chat","id":"chat-input","fields":{"NAME":"Question"},"next":{"block":condition}});
        let root=json!({"type":"core.agent","id":"agent-root","fields":{"ROLE":"Fixed reply"},"inputs":{"BODY":{"block":entry}}});
        let operations=json!([{"op":"block.add","moduleId":"main","blockId":"agent-root","payload":root}]);
        let inline=format!("$json:{}",serde_json::to_string_pretty(&operations).unwrap());
        succeeded(invoke(&mut cli,vec!["patch".into(),"create".into(),"$project".into(),"--operations".into(),inline,"--output".into(),"$patch".into()]));
        assert_eq!(cli.project,original);assert_eq!(cli.revision,0);
        let artifact=cli.patch.clone().expect("Real patch artifact");assert!(artifact.starts_with(cli.staging.path()));
        succeeded(invoke(&mut cli,["patch","preview","$project","--patch","$patch"].map(str::to_owned).to_vec()));
        assert_eq!(cli.project,original);
        succeeded(invoke(&mut cli,["patch","apply","$project","--patch","$patch","--output","$project"].map(str::to_owned).to_vec()));
        assert_eq!(cli.revision,1);assert_ne!(cli.project,original);assert_eq!(cli.project["manifest"]["projectId"],original["manifest"]["projectId"]);
        let candidate=cli.project.clone();let built=succeeded(invoke(&mut cli,["project","compile","$project"].map(str::to_owned).to_vec()));
        assert!(built["output"][0]["data"]["diagnostics"].as_array().unwrap().iter().all(|d|d["severity"]!="error"));
        for (id,kind) in [("conditional","core.logic.condition"),("repeat-three","core.flow.repeat"),("fixed-reply","core.message.reply")] {
            assert!(candidate.to_string().contains(id));assert!(built.to_string().contains(kind));
        }
        // The old artifact is digest-bound to the empty canvas and cannot be replayed.
        rejected_without_change(&mut cli,["patch","apply","$project","--patch","$patch","--output","$project"].map(str::to_owned).to_vec());
        let partial=json!([{"op":"block.update","moduleId":"main","blockId":"agent-root","payload":{"fields":{"ROLE":"must not apply"}}},{"op":"block.update","moduleId":"main","blockId":"missing","payload":{"fields":{"ROLE":"invalid"}}}]);
        rejected_without_change(&mut cli,vec!["patch".into(),"create".into(),"$project".into(),"--operations".into(),format!("$json:{partial}"),"--output".into(),"$patch".into()]);
        assert_eq!(cli.patch.as_ref(),Some(&artifact));
        let outside=cli.staging.path().parent().unwrap().join(format!("coding-cli-outside-{}.blocky",uuid::Uuid::new_v4())).to_string_lossy().to_string();
        rejected_without_change(&mut cli,vec!["patch".into(),"apply".into(),"$project".into(),"--patch".into(),"$patch".into(),"--output".into(),outside.clone()]);assert!(!Path::new(&outside).exists());
        rejected_without_change(&mut cli,["patch","preview","$project","--patch","../outside.json"].map(str::to_owned).to_vec());
        std::fs::remove_file(&artifact).unwrap();
        rejected_without_change(&mut cli,["patch","preview","$project","--patch","$patch"].map(str::to_owned).to_vec());
    }

    #[test]
    fn actual_cli_returns_candidate_diagnostics_and_can_correct_the_same_request() {
        assets().expect("Build the pinned CLI before this regression");
        let mut cli = isolated_cli();
        let original = cli.project.clone();
        let mut operations = json!([{"op":"block.add","moduleId":"main","blockId":"fixed-text","payload":{"type":"core.data.set","id":"fixed-text","fields":{"VALUE":"unquoted fixed text"}}}]);
        let args = |value: &Value| {
            vec![
                "patch".into(),
                "create".into(),
                "$project".into(),
                "--operations".into(),
                format!("$json:{value}"),
                "--output".into(),
                "$patch".into(),
            ]
        };
        let failed = invoke(&mut cli, args(&operations))
            .expect("Structured CLI failure must retain its error code and candidate diagnostics");
        assert_eq!(failed["exitCode"], 3);
        assert_eq!(failed["output"][0]["error"]["code"], "BLK-PATCH-004");
        assert!(
            failed["output"][0]["data"]["diagnostics"]
                .as_array()
                .unwrap()
                .iter()
                .any(|d| d["code"] == "BLK-TYPE-009")
        );
        assert_eq!(cli.project, original);
        assert_eq!(cli.revision, 0);
        assert!(cli.patch.is_none());
        operations[0]["payload"]["fields"]["VALUE"] = json!("\"quoted fixed text\"");
        succeeded(invoke(&mut cli, args(&operations)));
        succeeded(invoke(
            &mut cli,
            ["patch", "preview", "$project", "--patch", "$patch"]
                .map(str::to_owned)
                .to_vec(),
        ));
        succeeded(invoke(
            &mut cli,
            [
                "patch", "apply", "$project", "--patch", "$patch", "--output", "$project",
            ]
            .map(str::to_owned)
            .to_vec(),
        ));
        assert_eq!(cli.revision, 1);
        succeeded(invoke(
            &mut cli,
            ["project", "compile", "$project"]
                .map(str::to_owned)
                .to_vec(),
        ));
    }
}
