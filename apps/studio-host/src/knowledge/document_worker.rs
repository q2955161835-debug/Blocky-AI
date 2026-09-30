//! Pinned local parser. Each source gets a private read-only runtime snapshot;
//! each document gets a fresh AppContainer process and bounded pipes.
use super::*;
use crate::{
    process_worker::{IsolatedLaunch, Worker},
    tool_sandbox::Sandbox,
};
use serde::Deserialize;
use std::{
    ffi::OsString,
    fs,
    io::{Read, Write},
    path::{Component, Path, PathBuf},
    sync::mpsc,
    time::{Duration, Instant},
};
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Manifest {
    schema_version: String,
    files: Vec<Asset>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Asset {
    name: String,
    bytes: usize,
    sha256: String,
}
pub struct Parser {
    directory: Option<tempfile::TempDir>,
    sandbox: Sandbox,
}
fn runtime_root() -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|_| IO)?;
    let parent = exe.parent().ok_or(IO)?;
    let adjacent = parent.join("document-parser");
    if adjacent.is_dir() {
        return Ok(adjacent);
    }
    if parent.file_name().is_some_and(|s| s == "bin")
        && parent
            .parent()
            .and_then(Path::file_name)
            .is_some_and(|s| s == "cli")
    {
        return Ok(parent
            .parent()
            .and_then(Path::parent)
            .ok_or(IO)?
            .join("document-parser"));
    }
    Err("BLK-DOCUMENT-ASSET".into())
}
impl Parser {
    pub fn new(root: &Path) -> Result<Self, String> {
        Self::from_runtime(root, &runtime_root()?)
    }
    fn from_runtime(root: &Path, runtime: &Path) -> Result<Self, String> {
        let manifest: Manifest = serde_json::from_str(include_str!(
            "../../../../packages/document-parser/runtime-lock.json"
        ))
        .map_err(|_| "BLK-DOCUMENT-ASSET")?;
        if manifest.schema_version != "blocky.document-runtime/v1"
            || manifest.files.is_empty()
            || manifest.files.len() > 3500
        {
            return Err("BLK-DOCUMENT-ASSET".into());
        }
        let sessions = root.join("tool-sessions");
        fs::create_dir_all(&sessions).map_err(|_| IO)?;
        ingest::no_links(&sessions)?;
        ingest::no_links(runtime)?;
        let directory = tempfile::Builder::new()
            .prefix("document-")
            .tempdir_in(sessions)
            .map_err(|_| IO)?;
        let bundle = directory.path().join("bundle");
        fs::create_dir(&bundle).map_err(|_| IO)?;
        let mut seen = std::collections::HashSet::new();
        let mut total = 0usize;
        for asset in &manifest.files {
            if asset.name.is_empty()
                || asset.name.contains([':', '\\', '\0'])
                || !Path::new(&asset.name)
                    .components()
                    .all(|c| matches!(c, Component::Normal(_)))
                || !seen.insert(asset.name.to_ascii_lowercase())
                || asset.sha256.len() != 64
                || !asset.sha256.bytes().all(|b| b.is_ascii_hexdigit())
            {
                return Err("BLK-DOCUMENT-ASSET".into());
            }
            total = total.checked_add(asset.bytes).ok_or(LIMIT)?;
            if total > 256 * 1024 * 1024 {
                return Err(LIMIT.into());
            }
        }
        if !seen.contains("node.exe") || !seen.contains("worker.mjs") {
            return Err("BLK-DOCUMENT-ASSET".into());
        }
        let copying = crate::tool_sandbox::record_pending(
            directory.path(),
            manifest
                .files
                .iter()
                .map(|a| format!("bundle/{}", a.name))
                .collect(),
        )?;
        for asset in manifest.files {
            cancel::check()?;
            let source = runtime.join(&asset.name);
            ingest::no_links(&source)?;
            let bytes = super::store::read_bounded(&source, asset.bytes)?;
            if bytes.len() != asset.bytes || digest(&bytes) != asset.sha256 {
                return Err("BLK-DOCUMENT-ASSET".into());
            }
            let target = bundle.join(&asset.name);
            fs::create_dir_all(target.parent().ok_or(IO)?).map_err(|_| IO)?;
            fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(target)
                .and_then(|mut f| f.write_all(&bytes))
                .map_err(|_| IO)?;
        }
        drop(copying);
        let work = directory.path().join("work");
        fs::create_dir(&work).map_err(|_| IO)?;
        let mut sandbox = Sandbox::new(&directory)?;
        if let Err(error) = sandbox
            .grant_tree(&bundle, false)
            .and_then(|_| sandbox.grant_tree(&work, true))
        {
            sandbox.close()?;
            return Err(error);
        }
        Ok(Self {
            directory: Some(directory),
            sandbox,
        })
    }
    pub fn parse(&mut self, input: &[u8], extension: &str) -> Result<Vec<u8>, String> {
        cancel::check()?;
        if input.len() > super::document_result::INPUT_LIMIT
            || super::document_result::format(&format!("input.{extension}")).as_deref()
                != Some(extension)
        {
            return Err(LIMIT.into());
        }
        let root = self.directory.as_ref().ok_or("BLK-DOCUMENT-IO")?.path();
        let work = root.join("work");
        let path = work.join("input");
        let mut options = fs::OpenOptions::new();
        options.write(true).create(true).truncate(true);
        #[cfg(windows)]
        {
            use std::os::windows::fs::OpenOptionsExt;
            options.custom_flags(0x00200000);
        }
        if path.exists() {
            ingest::no_links(&path)?;
        }
        options
            .open(&path)
            .and_then(|mut f| f.write_all(input))
            .map_err(|_| IO)?;
        let bundle = root.join("bundle");
        let mut environment: Vec<(OsString, OsString)> = [
            "SYSTEMROOT",
            "SYSTEMDRIVE",
            "USERPROFILE",
            "LOCALAPPDATA",
            "APPDATA",
        ]
        .into_iter()
        .filter_map(|k| std::env::var_os(k).map(|v| (k.into(), v)))
        .collect();
        environment.extend([
            ("TEMP".into(), work.as_os_str().into()),
            ("TMP".into(), work.as_os_str().into()),
        ]);
        let args = [
            "--preserve-symlinks-main".into(),
            "--preserve-symlinks".into(),
            bundle.join("worker.mjs").into_os_string(),
            path.into_os_string(),
            extension.into(),
        ];
        let mut worker = Worker::spawn_sandboxed(
            &bundle.join("node.exe"),
            &args,
            &format!("Local\\BlockyDocument-{}", uuid::Uuid::new_v4()),
            IsolatedLaunch {
                environment: &environment,
                directory: &work,
                memory_limit: 512 * 1024 * 1024,
            },
            self.sandbox.sid(),
        )?;
        let output = worker.take_output().ok_or("BLK-DOCUMENT-IO")?;
        let error = worker.take_error().ok_or("BLK-DOCUMENT-IO")?;
        drop(worker.take_input());
        let (send, receive) = mpsc::sync_channel(1);
        let reader = std::thread::spawn(move || {
            let mut bytes = Vec::new();
            let result = output
                .take((super::document_result::OUTPUT_LIMIT + 1) as u64)
                .read_to_end(&mut bytes)
                .map_err(|_| "BLK-DOCUMENT-IO".to_string())
                .and_then(|_| {
                    if bytes.len() > super::document_result::OUTPUT_LIMIT {
                        Err("BLK-DOCUMENT-LIMIT".into())
                    } else {
                        Ok(bytes)
                    }
                });
            let _ = send.send(result);
        });
        let (error_send, error_receive) = mpsc::sync_channel(1);
        let errors = std::thread::spawn(move || {
            let mut bytes = Vec::new();
            let result = error.take(65537).read_to_end(&mut bytes);
            let _ = error_send.send(result.is_err() || bytes.len() > 65536);
        });
        let started = Instant::now();
        let result = (|| {
            worker.resume()?;
            loop {
                cancel::check()?;
                if started.elapsed() > Duration::from_secs(120) {
                    return Err("BLK-DOCUMENT-TIMEOUT".into());
                }
                if error_receive.try_recv() == Ok(true) {
                    return Err("BLK-DOCUMENT-LIMIT".into());
                }
                match receive.recv_timeout(Duration::from_millis(20)) {
                    Ok(result) => return result,
                    Err(mpsc::RecvTimeoutError::Timeout) => {}
                    Err(_) => return Err("BLK-DOCUMENT-IO".into()),
                }
            }
        })();
        worker.stop()?;
        reader.join().map_err(|_| "BLK-DOCUMENT-IO")?;
        errors.join().map_err(|_| "BLK-DOCUMENT-IO")?;
        cancel::check()?;
        result
    }
    pub fn close(&mut self) -> Result<(), String> {
        self.sandbox.close()?;
        if let Some(directory) = self.directory.take() {
            directory.close().map_err(|_| "BLK-DOCUMENT-CLEANUP")?;
        }
        Ok(())
    }
}
impl Drop for Parser {
    fn drop(&mut self) {
        let _ = self.close();
    }
}
