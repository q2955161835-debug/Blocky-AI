use super::protocol::require;
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
const ERROR: &str = "BLK-WORKFLOW-RUNTIME";
fn checked(path: &Path, bytes: u64, sha: &str) -> Result<PathBuf, String> {
    use std::os::windows::fs::MetadataExt;
    let parent = crate::profile::prepare(path.parent().ok_or(ERROR)?).map_err(|_| ERROR)?;
    let path = parent.join(path.file_name().ok_or(ERROR)?);
    let meta = std::fs::symlink_metadata(&path).map_err(|_| ERROR)?;
    require(
        meta.is_file()
            && meta.file_attributes() & 0x400 == 0
            && meta.len() == bytes
            && bytes <= 100 * 1024 * 1024,
        ERROR,
    )?;
    let data = std::fs::read(&path).map_err(|_| ERROR)?;
    require(format!("{:x}", Sha256::digest(data)) == sha, ERROR)?;
    Ok(path)
}
pub(super) fn assets() -> Result<(PathBuf, PathBuf), String> {
    let executable = std::env::current_exe().map_err(|_| ERROR)?;
    let parent = executable.parent().ok_or(ERROR)?;
    let mut candidates = vec![parent.parent().ok_or(ERROR)?.to_path_buf(), parent.join("cli")];
    #[cfg(debug_assertions)]
    candidates.push(
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .ok_or(ERROR)?
            .parent()
            .ok_or(ERROR)?
            .join("tools/blocky-cli/dist"),
    );
    let directory = candidates
        .into_iter()
        .find(|p| p.join("runtime-worker.mjs").is_file())
        .ok_or(ERROR)?;
    let lock: serde_json::Value = serde_json::from_str(include_str!(
        "../../../../tools/blocky-cli/runtime-worker-lock.json"
    ))
    .map_err(|_| ERROR)?;
    let script = checked(
        &directory.join("runtime-worker.mjs"),
        lock["bytes"].as_u64().ok_or(ERROR)?,
        lock["sha256"].as_str().ok_or(ERROR)?,
    )?;
    let nodes = [
        directory.join("bin/builder/node.exe"),
        directory.parent().ok_or(ERROR)?.join("builder/node.exe"),
    ];
    let node = nodes.iter().find(|p| p.is_file()).ok_or(ERROR)?;
    let runtime: serde_json::Value = serde_json::from_str(include_str!(
        "../../../../packages/builder-engine/runtime-lock.json"
    ))
    .map_err(|_| ERROR)?;
    let pin = runtime["files"]
        .as_array()
        .and_then(|files| files.iter().find(|file| file["name"] == "node.exe"))
        .ok_or(ERROR)?;
    let node = checked(
        node,
        pin["bytes"].as_u64().ok_or(ERROR)?,
        pin["sha256"].as_str().ok_or(ERROR)?,
    )?;
    Ok((node, script))
}
