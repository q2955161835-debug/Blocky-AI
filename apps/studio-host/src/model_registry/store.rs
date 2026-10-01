use super::{ERROR, VERSION, revision, validate_registry};
use serde_json::Value;
use std::{
    fs::{File, OpenOptions},
    io::Write,
    path::Path,
    time::{Duration, Instant},
};
fn read(path: &Path) -> Result<Option<Value>, String> {
    if !path.exists() {
        return Ok(None);
    }
    if std::fs::metadata(path).map_err(|_| ERROR)?.len() > 8 * 1024 * 1024 {
        return Err(ERROR.into());
    }
    Ok(Some(crate::strict_json::parse(
        &std::fs::read(path).map_err(|_| ERROR)?,
    )?))
}
fn locked(root: &Path) -> Result<File, String> {
    let dir = root.join("resources");
    std::fs::create_dir_all(&dir).map_err(|_| ERROR)?;
    let f = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(dir.join("registry.lock"))
        .map_err(|_| ERROR)?;
    let start = Instant::now();
    loop {
        match f.try_lock() {
            Ok(()) => return Ok(f),
            Err(std::fs::TryLockError::WouldBlock) => {
                if start.elapsed() > Duration::from_secs(2) {
                    return Err("BLK-RESOURCE-CONFLICT".into());
                }
                std::thread::sleep(Duration::from_millis(10));
            }
            Err(_) => return Err(ERROR.into()),
        }
    }
}
fn atomic(path: &Path, v: &Value) -> Result<(), String> {
    let bytes = serde_json::to_vec(v).map_err(|_| ERROR)?;
    if bytes.len() > 8 * 1024 * 1024 {
        return Err(ERROR.into());
    }
    let mut f = tempfile::NamedTempFile::new_in(path.parent().ok_or(ERROR)?).map_err(|_| ERROR)?;
    f.write_all(&bytes)
        .and_then(|_| f.as_file().sync_all())
        .map_err(|_| ERROR)?;
    f.persist(path).map_err(|_| ERROR)?;
    Ok(())
}
pub fn write_registry(root: &Path, value: &Value) -> Result<(), String> {
    let _lock = locked(root)?;
    let path = root.join("resources/app.json");
    let current = read(&path)?;
    if value["schemaVersion"] != VERSION {
        if current
            .as_ref()
            .is_some_and(|v| v["schemaVersion"] == VERSION)
        {
            return Err("BLK-RESOURCE-CONFLICT".into());
        }
        return atomic(&path, value);
    }
    validate_registry(value)?;
    let old_rev = current
        .as_ref()
        .filter(|v| v["schemaVersion"] == VERSION)
        .map(|v| revision(&v["revision"], 0))
        .transpose()?
        .unwrap_or(0);
    if value["revision"].as_u64() != Some(old_rev + 1) {
        return Err("BLK-RESOURCE-CONFLICT".into());
    }
    if let Some(old) = current.as_ref().filter(|v| v["schemaVersion"] == VERSION) {
        for p in value["providers"].as_array().ok_or(ERROR)? {
            let previous = old["providers"]
                .as_array()
                .ok_or(ERROR)?
                .iter()
                .find(|o| o["providerId"] == p["providerId"]);
            let expected = match previous {
                Some(o) if o == p => revision(&o["revision"], 1)?,
                Some(o) => revision(&o["revision"], 1)? + 1,
                None => 1,
            };
            if p["revision"].as_u64() != Some(expected) {
                return Err("BLK-RESOURCE-CONFLICT".into());
            }
        }
    }
    if let Some(v) = current
        .as_ref()
        .filter(|v| v["schemaVersion"] == "blocky.resource-registry/v1")
    {
        let backup = root.join("resources/app.v1-backup.json");
        if !backup.exists() {
            atomic(&backup, v)?;
        }
    }
    atomic(&path, value)
}
pub fn rollback(root: &Path, expected_revision: u64) -> Result<(), String> {
    let _lock = locked(root)?;
    let path = root.join("resources/app.json");
    let current = read(&path)?.ok_or(ERROR)?;
    if current["schemaVersion"] != VERSION
        || revision(&current["revision"], 0)? != expected_revision
    {
        return Err("BLK-RESOURCE-CONFLICT".into());
    }
    let old =
        read(&root.join("resources/app.v1-backup.json"))?.ok_or("BLK-RESOURCE-BACKUP-MISSING")?;
    if old["schemaVersion"] != "blocky.resource-registry/v1"
        || old.as_object().is_none_or(|v| v.len() != 2)
        || old["resources"].as_array().is_none_or(|r| r.len() > 256)
    {
        return Err(ERROR.into());
    }
    crate::project_store::check_secrets(&old, 0)?;
    atomic(&path, &old)
}
