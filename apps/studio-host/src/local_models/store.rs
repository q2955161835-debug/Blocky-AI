use super::*;
use serde_json::json;
use std::{
    collections::BTreeSet,
    fs::{File, OpenOptions},
    io::Read,
};
pub(super) fn path(root: &Path, id: &str) -> Result<PathBuf, String> {
    if id != MODEL_ID {
        return Err(INVALID.into());
    }
    if !root.is_absolute() {
        return Err("BLK-LOCAL-MODEL-PATH".into());
    }
    let directory = root.join("managed-models");
    std::fs::create_dir_all(&directory).map_err(|_| IO)?;
    crate::knowledge::no_links(&directory).map_err(|_| "BLK-LOCAL-MODEL-PATH")?;
    Ok(directory.join(id))
}
pub(super) fn guard(root: &Path) -> Result<File, String> {
    let parent = path(root, MODEL_ID)?.parent().ok_or(INVALID)?.to_owned();
    let path = parent.join("model.lock");
    if path.exists() {
        crate::knowledge::no_links(&path).map_err(|_| "BLK-LOCAL-MODEL-PATH")?;
    }
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(path)
        .map_err(|_| IO)?;
    file.try_lock().map_err(|_| "BLK-LOCAL-MODEL-BUSY")?;
    Ok(file)
}
fn manifest(directory: &Path, removing: bool) -> Result<(Value, artifacts::Backend), String> {
    crate::knowledge::no_links(directory).map_err(|_| "BLK-LOCAL-MODEL-PATH")?;
    let mut bytes = Vec::new();
    File::open(directory.join("manifest.json"))
        .map_err(|_| "BLK-LOCAL-MODEL-OWNERSHIP")?
        .take(4097)
        .read_to_end(&mut bytes)
        .map_err(|_| IO)?;
    if bytes.len() > 4096 {
        return Err("BLK-LOCAL-MODEL-OWNERSHIP".into());
    }
    let value = crate::strict_json::parse(&bytes).map_err(|_| "BLK-LOCAL-MODEL-OWNERSHIP")?;
    let locked = artifacts::lock()?;
    let backend = artifacts::backend(&locked, value["backend"].as_str().ok_or(INVALID)?)?;
    if value != manifest_value(&locked, &backend) {
        return Err("BLK-LOCAL-MODEL-OWNERSHIP".into());
    }
    let expected = BTreeSet::from([
        "manifest.json".to_string(),
        "model.gguf".into(),
        "runtime".into(),
        "LICENSE-llama.txt".into(),
        "LICENSE-Qwen.txt".into(),
    ]);
    exact_entries(directory, &expected, removing)?;
    if !removing || directory.join("runtime").exists() {
        exact_entries(
            &directory.join("runtime"),
            &backend.files.iter().map(|a| a.name.clone()).collect(),
            removing,
        )?;
    }
    Ok((value, backend))
}
pub(super) fn manifest_value(lock: &artifacts::Lock, backend: &artifacts::Backend) -> Value {
    json!({"schemaVersion":"blocky.managed-model/v1","modelId":lock.model_id,"modelSha256":lock.model.sha256,"runtimeVersion":lock.runtime_version,"backend":backend.id,"modelRevision":lock.model_revision})
}
fn exact_entries(
    directory: &Path,
    expected: &BTreeSet<String>,
    subset: bool,
) -> Result<(), String> {
    crate::knowledge::no_links(directory).map_err(|_| "BLK-LOCAL-MODEL-PATH")?;
    let mut actual = BTreeSet::new();
    for entry in std::fs::read_dir(directory).map_err(|_| IO)? {
        let entry = entry.map_err(|_| IO)?;
        crate::knowledge::no_links(&entry.path()).map_err(|_| "BLK-LOCAL-MODEL-PATH")?;
        actual.insert(entry.file_name().to_str().ok_or(INVALID)?.to_owned());
    }
    if !actual.is_subset(expected) || (!subset && &actual != expected) {
        return Err("BLK-LOCAL-MODEL-OWNERSHIP".into());
    }
    Ok(())
}
pub fn status(root: &Path, id: &str) -> Result<Value, String> {
    let directory = path(root, id)?;
    let locked = artifacts::lock()?;
    let mut value = json!({"modelId":id,"displayName":"Qwen3 0.6B","modelBytes":locked.model.bytes,"modelSha256":locked.model.sha256,"runtimeVersion":locked.runtime_version,"modelRevision":locked.model_revision,"capabilities":["text","tools","structured-output"],"installed":directory.is_dir(),"verified":false,"loaded":false,"externalApi":false,"backends":["cpu","vulkan"]});
    if directory.exists() {
        let (m, b) = manifest(&directory, false)?;
        value["backend"] = m["backend"].clone();
        let files = [
            "model.gguf",
            "manifest.json",
            "LICENSE-llama.txt",
            "LICENSE-Qwen.txt",
        ]
        .into_iter()
        .map(|name| directory.join(name))
        .chain(
            b.files
                .iter()
                .map(|a| directory.join("runtime").join(&a.name)),
        );
        value["installedBytes"] = json!(
            files
                .map(|p| std::fs::metadata(p).map(|m| m.len()).map_err(|_| IO))
                .collect::<Result<Vec<_>, _>>()?
                .into_iter()
                .sum::<u64>()
        );
    }
    value["busy"] = json!(guard(root).is_err());
    if value["busy"] == true {
        value["loaded"] = Value::Null;
    }
    Ok(value)
}
/// Keeps verified artifacts open without write/delete sharing throughout inference.
pub(super) fn verify_open(
    root: &Path,
    id: &str,
    cancel: &AtomicBool,
) -> Result<(PathBuf, artifacts::Backend, Vec<File>), String> {
    let directory = path(root, id)?;
    if !directory.exists() {
        return Err("BLK-LOCAL-MODEL-MISSING".into());
    }
    let (_, backend) = manifest(&directory, false)?;
    let locked = artifacts::lock()?;
    let mut files = vec![artifacts::open_asset(
        &directory.join("model.gguf"),
        &locked.model,
        cancel,
    )?];
    for asset in &backend.files {
        files.push(artifacts::open_asset(
            &directory.join("runtime").join(&asset.name),
            asset,
            cancel,
        )?);
    }
    Ok((directory, backend, files))
}
pub fn verify(root: &Path, id: &str, cancel: &AtomicBool) -> Result<Value, String> {
    let _guard = guard(root)?;
    drop(verify_open(root, id, cancel)?);
    let mut value = status(root, id)?;
    value["verified"] = true.into();
    value["busy"] = false.into();
    value["loaded"] = false.into();
    Ok(value)
}
pub fn install(
    root: &Path,
    id: &str,
    backend: &str,
    source: Option<&InstallSource>,
    cancel: &AtomicBool,
) -> Result<Value, String> {
    let target = path(root, id)?;
    let _guard = guard(root)?;
    artifacts::cancelled(cancel)?;
    if target.exists() {
        return Err("BLK-LOCAL-MODEL-EXISTS".into());
    }
    let locked = artifacts::lock()?;
    let backend = artifacts::backend(&locked, backend)?;
    let parent = target.parent().ok_or(INVALID)?;
    let staging = tempfile::Builder::new()
        .prefix(".install-")
        .tempdir_in(parent)
        .map_err(|_| IO)?;
    let archive = staging.path().join("runtime.zip");
    artifacts::obtain(
        &archive,
        source.map(|s| s.runtime_file.as_path()),
        &backend.archive,
        cancel,
    )?;
    artifacts::extract(&archive, &staging.path().join("runtime"), &backend, cancel)?;
    std::fs::remove_file(&archive).map_err(|_| IO)?;
    artifacts::obtain(
        &staging.path().join("model.gguf"),
        source.map(|s| s.model_file.as_path()),
        &locked.model,
        cancel,
    )?;
    std::fs::write(
        staging.path().join("LICENSE-llama.txt"),
        include_bytes!("LICENSE-llama.txt"),
    )
    .map_err(|_| IO)?;
    std::fs::write(
        staging.path().join("LICENSE-Qwen.txt"),
        include_bytes!("LICENSE-Qwen.txt"),
    )
    .map_err(|_| IO)?;
    std::fs::write(
        staging.path().join("manifest.json"),
        manifest_value(&locked, &backend).to_string(),
    )
    .map_err(|_| IO)?;
    artifacts::cancelled(cancel)?;
    std::fs::rename(staging.path(), &target).map_err(|_| IO)?;
    let mut result = status(root, id)?;
    result["verified"] = true.into();
    result["busy"] = false.into();
    result["loaded"] = false.into();
    Ok(result)
}
pub fn remove(root: &Path, id: &str) -> Result<Value, String> {
    let directory = path(root, id)?;
    let _guard = guard(root)?;
    if !directory.exists() {
        return Ok(json!({"modelId":id,"removed":false}));
    }
    let (_, backend) = manifest(&directory, true)?;
    // Exact owned files only, no recursive traversal of user-selected paths.
    for asset in &backend.files {
        let file = directory.join("runtime").join(&asset.name);
        if file.exists() {
            std::fs::remove_file(file).map_err(|_| IO)?;
        }
    }
    if directory.join("runtime").exists() {
        std::fs::remove_dir(directory.join("runtime")).map_err(|_| IO)?;
    }
    for name in [
        "model.gguf",
        "LICENSE-llama.txt",
        "LICENSE-Qwen.txt",
        "manifest.json",
    ] {
        let file = directory.join(name);
        if file.exists() {
            std::fs::remove_file(file).map_err(|_| IO)?;
        }
    }
    std::fs::remove_dir(directory).map_err(|_| IO)?;
    Ok(json!({"modelId":id,"removed":true}))
}
