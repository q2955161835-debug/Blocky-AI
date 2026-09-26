//! Browser-specific launch; framing, deadlines and Job settlement are shared.
use crate::rpa::ipc::PipeProcess;
#[cfg(test)]
pub(super) use crate::rpa::ipc::join_bounded;
use serde_json::json;
use std::{
    path::Path,
    process::{Command, Stdio},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
};
const WIRE: &str = "BLK-RPA-WIRE-001";
pub(super) fn start(root: &Path, cancel: Arc<AtomicBool>) -> Result<PipeProcess, String> {
    if cancel.load(Ordering::SeqCst) {
        return Err("BLK-RPA-CANCELLED".into());
    }
    let directory = super::assets::locate()?;
    let edge = super::assets::edge()?;
    std::fs::create_dir_all(root).map_err(|_| "BLK-RPA-RUNTIME-001")?;
    let temporary = tempfile::Builder::new()
        .prefix("browser-")
        .tempdir_in(root)
        .map_err(|_| "BLK-RPA-RUNTIME-001")?;
    let mut command = Command::new(directory.join("node.exe"));
    command
        .env_clear()
        .arg("--no-addons")
        .arg(directory.join("browser.mjs"))
        .current_dir(&directory)
        .env("TEMP", temporary.path())
        .env("TMP", temporary.path())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    if let Some(value) = std::env::var_os("SystemRoot") {
        command.env("SystemRoot", value);
    }
    let artifacts_path = temporary.path().to_owned();
    let mut process = PipeProcess::spawn(
        command,
        Some(temporary),
        "blocky.browser-ipc/v1",
        cancel.clone(),
    )?;
    let response = process.request(
        json!({"kind":"init","executablePath":edge,"artifactsPath":artifacts_path}),
        20000,
        cancel,
    );
    match response {
        Ok(value) if value == json!({"ready":true}) => {}
        Ok(_) => {
            process.terminate()?;
            return Err(WIRE.into());
        }
        Err(code) => {
            process.terminate()?;
            return Err(code);
        }
    }
    Ok(process)
}
