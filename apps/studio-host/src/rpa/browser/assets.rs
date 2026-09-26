use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeSet,
    path::{Path, PathBuf},
};
const ERROR: &str = "BLK-RPA-RUNTIME-001";
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Manifest {
    schema_version: String,
    node_version: String,
    playwright_version: String,
    files: Vec<File>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct File {
    name: String,
    bytes: u64,
    sha256: String,
}
pub(super) fn locate() -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|_| ERROR)?;
    let directory = exe.parent().ok_or(ERROR)?;
    let mut candidates = vec![directory.join("browser")];
    if directory.file_name().is_some_and(|n| n == "bin")
        && directory
            .parent()
            .and_then(|p| p.file_name())
            .is_some_and(|n| n == "cli")
    {
        candidates.push(
            directory
                .parent()
                .and_then(|p| p.parent())
                .ok_or(ERROR)?
                .join("browser"),
        );
    }
    #[cfg(debug_assertions)]
    candidates.push(Path::new(env!("CARGO_MANIFEST_DIR")).join("../../try/stage7/browser-runtime"));
    let directory = candidates
        .into_iter()
        .find(|p| p.join("manifest.json").is_file())
        .ok_or(ERROR)?;
    verify(&directory)?;
    let directory = directory.canonicalize().map_err(|_| ERROR)?;
    // Node's Windows main resolver does not support a verbatim drive prefix.
    Ok(PathBuf::from(
        directory
            .to_string_lossy()
            .strip_prefix("\\\\?\\")
            .ok_or(ERROR)?,
    ))
}
fn ordinary(path: &Path) -> Result<std::fs::Metadata, String> {
    use std::os::windows::fs::MetadataExt;
    let metadata = std::fs::symlink_metadata(path).map_err(|_| ERROR)?;
    if metadata.file_attributes() & 0x400 != 0 {
        return Err(ERROR.into());
    }
    Ok(metadata)
}
fn inventory(path: &Path, prefix: &str, found: &mut BTreeSet<String>) -> Result<(), String> {
    if !ordinary(path)?.is_dir() {
        return Err(ERROR.into());
    }
    for entry in std::fs::read_dir(path).map_err(|_| ERROR)? {
        let entry = entry.map_err(|_| ERROR)?;
        let name = entry.file_name().into_string().map_err(|_| ERROR)?;
        if !name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b))
        {
            return Err(ERROR.into());
        }
        let relative = if prefix.is_empty() {
            name
        } else {
            format!("{prefix}/{name}")
        };
        let metadata = ordinary(&entry.path())?;
        if metadata.is_dir() {
            if relative.split('/').count() > 12 {
                return Err(ERROR.into());
            }
            inventory(&entry.path(), &relative, found)?;
        } else if metadata.is_file() {
            if relative != "manifest.json" {
                found.insert(relative);
            }
        } else {
            return Err(ERROR.into());
        }
        if found.len() > 512 {
            return Err(ERROR.into());
        }
    }
    Ok(())
}
pub(super) fn verify(directory: &Path) -> Result<(), String> {
    let metadata = ordinary(&directory.join("manifest.json"))?;
    if !metadata.is_file() || metadata.len() > 131072 {
        return Err(ERROR.into());
    }
    let bytes = std::fs::read(directory.join("manifest.json")).map_err(|_| ERROR)?;
    let value = crate::strict_json::parse(&bytes).map_err(|_| ERROR)?;
    let pinned = crate::strict_json::parse(include_bytes!(
        "../../../../../packages/rpa-core/runtime-lock.json"
    ))
    .map_err(|_| ERROR)?;
    if value != pinned {
        return Err("BLK-RPA-RUNTIME-HASH".into());
    }
    let manifest: Manifest = serde_json::from_value(value).map_err(|_| ERROR)?;
    if manifest.schema_version != "blocky.browser-runtime/v1"
        || manifest.node_version != "22.23.1"
        || manifest.playwright_version != "1.63.0"
        || manifest.files.len() > 512
    {
        return Err(ERROR.into());
    }
    let mut found = BTreeSet::new();
    inventory(directory, "", &mut found)?;
    let mut expected = BTreeSet::new();
    let mut total = 0u64;
    for file in manifest.files {
        if !file.name.split('/').all(|part| {
            !part.is_empty()
                && part != "."
                && part != ".."
                && part
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b))
        }) || !expected.insert(file.name.clone())
        {
            return Err(ERROR.into());
        }
        total = total.checked_add(file.bytes).ok_or(ERROR)?;
        if file.bytes > 120 * 1024 * 1024 || total > 160 * 1024 * 1024 {
            return Err(ERROR.into());
        }
        let path = directory.join(&file.name);
        let metadata = ordinary(&path)?;
        if !metadata.is_file() || metadata.len() != file.bytes {
            return Err("BLK-RPA-RUNTIME-HASH".into());
        }
        let bytes = std::fs::read(path).map_err(|_| ERROR)?;
        if format!("{:x}", Sha256::digest(bytes)) != file.sha256 {
            return Err("BLK-RPA-RUNTIME-HASH".into());
        }
    }
    if found != expected {
        return Err("BLK-RPA-RUNTIME-HASH".into());
    }
    Ok(())
}
pub(super) fn edge() -> Result<PathBuf, String> {
    for key in ["ProgramFiles(x86)", "ProgramFiles"] {
        if let Some(directory) = std::env::var_os(key) {
            let candidate = PathBuf::from(directory).join("Microsoft/Edge/Application/msedge.exe");
            if candidate.is_file() {
                return Ok(candidate);
            }
        }
    }
    Err("BLK-RPA-BROWSER-MISSING".into())
}
