use super::*;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::BTreeSet,
    fs::{File, OpenOptions},
    io::Write,
};
const OWNERSHIP: &str = "BLK-TOOL-OWNERSHIP";
#[cfg(test)]
#[path = "cleanup_tests.rs"]
mod tests;
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Manifest {
    schema_version: String,
    profile_name: String,
    bundle_files: Vec<String>,
}
fn tree(
    path: &Path,
    files: &mut Vec<PathBuf>,
    dirs: &mut Vec<PathBuf>,
    depth: usize,
) -> Result<u64, String> {
    if depth > 20 || files.len() + dirs.len() > 8192 {
        return Err(OWNERSHIP.into());
    }
    crate::knowledge::no_links(path).map_err(|_| OWNERSHIP)?;
    let mut bytes = 0;
    if path.is_file() {
        files.push(path.to_owned());
        return Ok(path.metadata().map_err(|_| OWNERSHIP)?.len());
    }
    if !path.is_dir() {
        return Err(OWNERSHIP.into());
    }
    for entry in std::fs::read_dir(path).map_err(|_| OWNERSHIP)? {
        bytes += tree(
            &entry.map_err(|_| OWNERSHIP)?.path(),
            files,
            dirs,
            depth + 1,
        )?;
    }
    dirs.push(path.to_owned());
    Ok(bytes)
}
pub(super) fn record(root: &Path, profile: &str) -> Result<(), String> {
    let mut files = Vec::new();
    tree(&root.join("bundle"), &mut files, &mut Vec::new(), 0)?;
    let manifest = Manifest {
        schema_version: "blocky.tool-sandbox/v1".into(),
        profile_name: profile.into(),
        bundle_files: files
            .iter()
            .map(|path| {
                path.strip_prefix(root)
                    .map(|p| p.to_string_lossy().replace('\\', "/"))
                    .map_err(|_| OWNERSHIP)
            })
            .collect::<Result<_, _>>()?,
    };
    if root.join("sandbox.json").exists() {
        let previous: Manifest = serde_json::from_value(crate::strict_json::parse(
            &std::fs::read(root.join("sandbox.json")).map_err(|_| OWNERSHIP)?,
        )?)
        .map_err(|_| OWNERSHIP)?;
        if previous.schema_version != manifest.schema_version
            || !previous.profile_name.is_empty()
            || previous.bundle_files.into_iter().collect::<BTreeSet<_>>()
                != manifest.bundle_files.iter().cloned().collect()
        {
            return Err(OWNERSHIP.into());
        }
    }
    save(root, &manifest)
}
fn save(root: &Path, manifest: &Manifest) -> Result<(), String> {
    let mut file = tempfile::NamedTempFile::new_in(root).map_err(|_| OWNERSHIP)?;
    file.write_all(&serde_json::to_vec(&manifest).map_err(|_| OWNERSHIP)?)
        .and_then(|_| file.as_file().sync_all())
        .map_err(|_| OWNERSHIP)?;
    file.persist(root.join("sandbox.json"))
        .map_err(|_| OWNERSHIP)?;
    Ok(())
}
pub(crate) fn record_pending(root: &Path, files: Vec<String>) -> Result<File, String> {
    let file = OpenOptions::new()
        .create_new(true)
        .read(true)
        .write(true)
        .open(root.join("sandbox.lock"))
        .map_err(|_| OWNERSHIP)?;
    file.try_lock().map_err(|_| "BLK-TOOL-BUSY")?;
    save(
        root,
        &Manifest {
            schema_version: "blocky.tool-sandbox/v1".into(),
            profile_name: String::new(),
            bundle_files: files,
        },
    )?;
    Ok(file)
}
struct Candidate {
    profile: Vec<u16>,
    files: Vec<PathBuf>,
    dirs: Vec<PathBuf>,
    bytes: u64,
    lock: File,
}
fn candidates(profile: &Path) -> Result<(Vec<Candidate>, usize, usize), String> {
    let root = profile.join("tool-sessions");
    if !root.exists() {
        return Ok((vec![], 0, 0));
    }
    crate::knowledge::no_links(&root).map_err(|_| OWNERSHIP)?;
    let mut result = Vec::new();
    let mut active = 0;
    let mut unknown = 0;
    let mut count = 0;
    for entry in std::fs::read_dir(&root).map_err(|_| OWNERSHIP)? {
        count += 1;
        if count > 128 {
            return Err("BLK-TOOL-LIMIT".into());
        }
        let entry = entry.map_err(|_| OWNERSHIP)?;
        let path = entry.path();
        crate::knowledge::no_links(&path).map_err(|_| OWNERSHIP)?;
        if !entry.file_name().to_string_lossy().starts_with("mcp-") || !path.is_dir() {
            unknown += 1;
            continue;
        }
        let metadata = path.join("sandbox.json");
        let lock_path = path.join("sandbox.lock");
        if !metadata.is_file() || !lock_path.is_file() {
            unknown += 1;
            continue;
        }
        crate::knowledge::no_links(&metadata).map_err(|_| OWNERSHIP)?;
        crate::knowledge::no_links(&lock_path).map_err(|_| OWNERSHIP)?;
        let lock = OpenOptions::new()
            .read(true)
            .write(true)
            .open(&lock_path)
            .map_err(|_| OWNERSHIP)?;
        if lock.try_lock().is_err() {
            active += 1;
            continue;
        }
        if metadata.metadata().map_err(|_| OWNERSHIP)?.len() > 1024 * 1024 {
            return Err(OWNERSHIP.into());
        }
        let manifest: Manifest = serde_json::from_value(crate::strict_json::parse(
            &std::fs::read(&metadata).map_err(|_| OWNERSHIP)?,
        )?)
        .map_err(|_| OWNERSHIP)?;
        if manifest.schema_version != "blocky.tool-sandbox/v1"
            || (!manifest.profile_name.is_empty()
                && (!manifest.profile_name.starts_with("Blocky.Tool.")
                    || uuid::Uuid::parse_str(&manifest.profile_name["Blocky.Tool.".len()..])
                        .is_err()))
        {
            return Err(OWNERSHIP.into());
        }
        let allowed = manifest.bundle_files.into_iter().collect::<BTreeSet<_>>();
        if allowed.iter().any(|p| {
            !p.starts_with("bundle/")
                || p.contains(['\\', ':'])
                || Path::new(p)
                    .components()
                    .any(|c| !matches!(c, std::path::Component::Normal(_)))
        }) {
            return Err(OWNERSHIP.into());
        }
        let mut files = Vec::new();
        let mut dirs = Vec::new();
        let bytes = tree(&path, &mut files, &mut dirs, 0)?;
        for file in &files {
            let relative = file
                .strip_prefix(&path)
                .map_err(|_| OWNERSHIP)?
                .to_string_lossy()
                .replace('\\', "/");
            if !["sandbox.json", "sandbox.lock"].contains(&relative.as_str())
                && !relative.starts_with("work/")
                && !allowed.contains(&relative)
            {
                return Err(OWNERSHIP.into());
            }
        }
        if dirs.iter().any(|d| {
            d != &path && !d.starts_with(path.join("bundle")) && !d.starts_with(path.join("work"))
        }) {
            return Err(OWNERSHIP.into());
        }
        result.push(Candidate {
            profile: manifest
                .profile_name
                .encode_utf16()
                .chain(Some(0))
                .collect(),
            files,
            dirs,
            bytes,
            lock,
        });
    }
    Ok((result, active, unknown))
}
pub(crate) fn cleanup_status(profile: &Path) -> Result<Value, String> {
    let (candidates, active, unknown) = candidates(profile)?;
    Ok(
        json!({"incompleteSessions":candidates.len(),"incompleteBytes":candidates.iter().map(|c|c.bytes).sum::<u64>(),"activeSessions":active,"unrecognizedSessions":unknown}),
    )
}
pub(crate) fn cleanup(profile: &Path) -> Result<Value, String> {
    let (candidates, active, unknown) = candidates(profile)?;
    if active > 0 {
        return Err("BLK-TOOL-BUSY".into());
    }
    if unknown > 0 {
        return Err(OWNERSHIP.into());
    }
    let count = candidates.len();
    let bytes = candidates.iter().map(|c| c.bytes).sum::<u64>();
    // All directory contents and ownership records are checked before deleting any.
    for candidate in candidates {
        let result = if candidate.profile.len() > 1 {
            unsafe { DeleteAppContainerProfile(candidate.profile.as_ptr()) }
        } else {
            0
        };
        // HRESULT_FROM_WIN32(ERROR_FILE_NOT_FOUND) also means no profile remains.
        if result < 0 && result != 0x80070002u32 as i32 {
            return Err("BLK-TOOL-CLEANUP".into());
        }
        let root = candidate.dirs.last().ok_or(OWNERSHIP)?;
        let metadata = root.join("sandbox.json");
        let lock = root.join("sandbox.lock");
        for path in &candidate.files {
            if path != &metadata && path != &lock {
                std::fs::remove_file(path).map_err(|_| "BLK-TOOL-CLEANUP")?;
            }
        }
        for path in &candidate.dirs {
            if path != root {
                std::fs::remove_dir(path).map_err(|_| "BLK-TOOL-CLEANUP")?;
            }
        }
        drop(candidate.lock);
        std::fs::remove_file(lock).map_err(|_| "BLK-TOOL-CLEANUP")?;
        std::fs::remove_file(metadata).map_err(|_| "BLK-TOOL-CLEANUP")?;
        std::fs::remove_dir(root).map_err(|_| "BLK-TOOL-CLEANUP")?;
    }
    Ok(json!({"removedSessions":count,"removedBytes":bytes}))
}
