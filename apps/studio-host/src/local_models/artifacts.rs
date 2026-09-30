use super::*;
use sha2::{Digest, Sha256};
use std::{
    fs::File,
    io::{Read, Write},
};
#[derive(Clone, serde::Deserialize)]
pub(super) struct Asset {
    pub name: String,
    pub bytes: u64,
    pub sha256: String,
    pub url: Option<String>,
}
#[derive(Clone, serde::Deserialize)]
pub(super) struct Backend {
    pub id: String,
    pub archive: Asset,
    pub files: Vec<Asset>,
}
#[derive(Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Lock {
    pub model_id: String,
    pub model: Asset,
    pub backends: Vec<Backend>,
    pub runtime_version: String,
    pub model_revision: String,
}
pub(super) fn lock() -> Result<Lock, String> {
    serde_json::from_str(include_str!("artifact-lock.json")).map_err(|_| INVALID.into())
}
pub(super) fn backend(lock: &Lock, id: &str) -> Result<Backend, String> {
    lock.backends
        .iter()
        .find(|b| b.id == id)
        .cloned()
        .ok_or(INVALID.into())
}
pub(super) fn cancelled(cancel: &AtomicBool) -> Result<(), String> {
    if cancel.load(Ordering::SeqCst) {
        Err("BLK-LOCAL-MODEL-CANCELLED".into())
    } else {
        Ok(())
    }
}
pub(super) fn open_asset(path: &Path, asset: &Asset, cancel: &AtomicBool) -> Result<File, String> {
    cancelled(cancel)?;
    crate::knowledge::no_links(path).map_err(|_| "BLK-LOCAL-MODEL-PATH")?;
    let mut options = std::fs::OpenOptions::new();
    options.read(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        options.share_mode(1);
    }
    let mut file = options.open(path).map_err(|_| "BLK-LOCAL-MODEL-MISSING")?;
    if file.metadata().map_err(|_| IO)?.len() != asset.bytes {
        return Err("BLK-LOCAL-MODEL-HASH".into());
    }
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 131072];
    let mut count = 0u64;
    loop {
        cancelled(cancel)?;
        let n = file.read(&mut buffer).map_err(|_| IO)?;
        if n == 0 {
            break;
        }
        count += n as u64;
        if count > asset.bytes {
            return Err("BLK-LOCAL-MODEL-HASH".into());
        }
        hasher.update(&buffer[..n]);
    }
    if count != asset.bytes || format!("{:x}", hasher.finalize()) != asset.sha256 {
        return Err("BLK-LOCAL-MODEL-HASH".into());
    }
    use std::io::{Seek, SeekFrom};
    file.seek(SeekFrom::Start(0)).map_err(|_| IO)?;
    Ok(file)
}
fn copy(mut input: File, path: &Path, asset: &Asset, cancel: &AtomicBool) -> Result<(), String> {
    let mut output = File::create(path).map_err(|_| IO)?;
    let mut buf = [0u8; 131072];
    let mut count = 0u64;
    loop {
        cancelled(cancel)?;
        let n = input.read(&mut buf).map_err(|_| IO)?;
        if n == 0 {
            break;
        }
        count += n as u64;
        if count > asset.bytes {
            return Err("BLK-LOCAL-MODEL-HASH".into());
        }
        output.write_all(&buf[..n]).map_err(|_| IO)?;
    }
    output.sync_all().map_err(|_| IO)?;
    drop(output);
    drop(open_asset(path, asset, cancel)?);
    Ok(())
}
pub(super) fn obtain(
    path: &Path,
    source: Option<&Path>,
    asset: &Asset,
    cancel: &AtomicBool,
) -> Result<(), String> {
    match source {
        Some(source) => copy(open_asset(source, asset, cancel)?, path, asset, cancel),
        None => super::download::download(path, asset, cancel),
    }
}
pub(super) fn extract(
    path: &Path,
    target: &Path,
    backend: &Backend,
    cancel: &AtomicBool,
) -> Result<(), String> {
    let input = open_asset(path, &backend.archive, cancel)?;
    let mut archive = zip::ZipArchive::new(input).map_err(|_| "BLK-LOCAL-MODEL-ARCHIVE")?;
    if archive.len() > 256 {
        return Err("BLK-LOCAL-MODEL-ARCHIVE".into());
    }
    std::fs::create_dir(target).map_err(|_| IO)?;
    // Only compiled-in filenames are extracted; no archive name becomes an output path.
    for asset in &backend.files {
        cancelled(cancel)?;
        let mut entry = archive
            .by_name(&asset.name)
            .map_err(|_| "BLK-LOCAL-MODEL-ARCHIVE")?;
        if entry.is_dir() || entry.is_symlink() || entry.size() != asset.bytes {
            return Err("BLK-LOCAL-MODEL-ARCHIVE".into());
        }
        let path = target.join(&asset.name);
        let mut output = File::create(&path).map_err(|_| IO)?;
        std::io::copy(&mut entry.by_ref().take(asset.bytes + 1), &mut output).map_err(|_| IO)?;
        output.sync_all().map_err(|_| IO)?;
        drop(output);
        drop(open_asset(&path, asset, cancel)?);
    }
    Ok(())
}
