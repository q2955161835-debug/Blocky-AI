use serde_json::{json, Value};
use std::{fs::OpenOptions, io::Write, path::Path};
const ERROR: &str = "BLK-UI-PREFERENCES";
pub fn validate(doc: &Value) -> Result<(), String> {
    let map = doc.as_object().ok_or(ERROR)?;
    if doc["schemaVersion"] != "blocky.ui-preferences/v1"
        || map.len() != 2
        || map
            .keys()
            .any(|k| !["schemaVersion", "values"].contains(&k.as_str()))
    {
        return Err(ERROR.into());
    }
    for (key, value) in doc["values"].as_object().ok_or(ERROR)? {
        let valid = match key.as_str() {
            "permissionMode" => matches!(value.as_str(), Some("full" | "ask")),
            "theme" => matches!(value.as_str(), Some("dark" | "light" | "system")),
            "fontFamily" => matches!(value.as_str(), Some("system" | "yahei" | "simsun")),
            "codeFont" => matches!(value.as_str(), Some("consolas" | "courier" | "system")),
            "fontSize" => value.as_u64().is_some_and(|n| (11..=24).contains(&n)),
            "builderModelId" | "agentModelId" => value.as_str().is_some_and(|id| {
                id.is_empty()
                    || id.len() <= 128
                        && crate::project_store::stable(id)
                        && !id.to_ascii_lowercase().starts_with("sk-")
                        && !["__proto__", "prototype", "constructor"].contains(&id)
            }),
            "builderReasoningEffort" | "agentReasoningEffort" => {
                matches!(value.as_str(), Some("none" | "low" | "high" | "max"))
            }
            _ => false,
        };
        if !valid {
            return Err(ERROR.into());
        }
    }
    Ok(())
}
/// Merge only the changed field while holding a profile-wide OS lock.
pub fn patch(root: &Path, id: &str, value: Value) -> Result<Value, String> {
    validate(&json!({"schemaVersion":"blocky.ui-preferences/v1","values":{id:value}}))?;
    let dir = root.join("ui-preferences");
    std::fs::create_dir_all(&dir).map_err(|_| ERROR)?;
    let lease = OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(dir.join("app.lock"))
        .map_err(|_| ERROR)?;
    lease.lock().map_err(|_| ERROR)?;
    let path = dir.join("app.json");
    let mut doc = if path.exists() {
        if std::fs::metadata(&path).map_err(|_| ERROR)?.len() > 4096 {
            return Err(ERROR.into());
        }
        crate::strict_json::parse(&std::fs::read(&path).map_err(|_| ERROR)?)?
    } else {
        json!({"schemaVersion":"blocky.ui-preferences/v1","values":{}})
    };
    validate(&doc)?;
    doc["values"]
        .as_object_mut()
        .ok_or(ERROR)?
        .insert(id.to_owned(), value);
    validate(&doc)?;
    let mut temp = tempfile::NamedTempFile::new_in(&dir).map_err(|_| ERROR)?;
    temp.write_all(&serde_json::to_vec(&doc).map_err(|_| ERROR)?)
        .and_then(|_| temp.as_file().sync_all())
        .map_err(|_| ERROR)?;
    temp.persist(&path).map_err(|_| ERROR)?;
    Ok(doc)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn concurrent_windows_merge_and_invalid_change_preserves_saved_preferences() {
        let dir = tempfile::tempdir().unwrap();
        std::thread::scope(|s| {
            s.spawn(|| {
                patch(dir.path(), "theme", json!("light")).unwrap();
            });
            s.spawn(|| {
                patch(dir.path(), "fontSize", json!(18)).unwrap();
            });
        });
        let path = dir.path().join("ui-preferences/app.json");
        let before = std::fs::read(&path).unwrap();
        let doc: Value = serde_json::from_slice(&before).unwrap();
        assert_eq!(doc["values"]["theme"], "light");
        assert_eq!(doc["values"]["fontSize"], 18);
        assert!(patch(dir.path(), "fontSize", json!(999)).is_err());
        assert_eq!(std::fs::read(&path).unwrap(), before);
        std::fs::write(&path, b"{\"schemaVersion\":\"future\",\"values\":{}}").unwrap();
        let corrupt = std::fs::read(&path).unwrap();
        assert!(patch(dir.path(), "theme", json!("dark")).is_err());
        assert_eq!(std::fs::read(path).unwrap(), corrupt);
    }
}
