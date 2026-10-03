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
        })
    }
    pub fn run(
        &mut self,
        args: &[String],
        scope: Option<&Scope>,
        cancel: &AtomicBool,
    ) -> Result<Value, String> {
        let prepared = prepare(args)?;
        let mut args = args.to_vec();
        let mut input = 0;
        for index in prepared.inputs {
            if args[index] == "$project" {
                args[index] = self
                    .staging
                    .path()
                    .join(format!("project-{}.blocky", self.revision))
                    .to_string_lossy()
                    .into_owned();
            } else {
                let path = &args[index];
                let content = if let Some(inline) = path.strip_prefix("$json:") {
                    if inline.len() > 256 * 1024 {
                        return Err("BLK-CODING-BUDGET".into());
                    }
                    let value = crate::strict_json::parse(inline.as_bytes()).map_err(|_| ERROR)?;
                    if (!value.is_object() && !value.is_array())
                        || crate::builder::contains_credentials(&value)
                    {
                        return Err(ERROR.into());
                    }
                    crate::project_store::check_secrets(&value, 0).map_err(|_| ERROR)?;
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
        if let Some(i) = prepared.output {
            if args[i] != "$project" {
                return Err(ERROR.into());
            }
            if prepared.modifies {
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
        // Never send arbitrary process diagnostics, native paths or secrets to the model.
        let mut frames = Vec::new();
        for line in output.lines() {
            frames.push(crate::strict_json::parse(line.as_bytes()).map_err(|_| ERROR)?);
        }
        let safe = serde_json::to_value(frames).map_err(|_| ERROR)?;
        if crate::builder::contains_credentials(&safe) || !errors.trim().is_empty() {
            return Err(ERROR.into());
        }
        if status.success() {
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
}
fn prepare(args: &[String]) -> Result<Prepared, String> {
    if args.len() < 2
        || args.len() > 64
        || args
            .iter()
            .any(|a| a.is_empty() || a.len() > 256 * 1024 + 6 || a.chars().any(char::is_control))
    {
        return Err(ERROR.into());
    }
    if args == ["--version".to_owned(), "--json".to_owned()] {
        return Ok(Prepared {
            inputs: Vec::new(),
            output: None,
            modifies: false,
        });
    }
    let command = format!("{}.{}", args[0], args[1]);
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
    if words != positional || !seen.contains("json") || modifies != output.is_some() {
        return Err(ERROR.into());
    }
    Ok(Prepared {
        inputs,
        output,
        modifies,
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
}
