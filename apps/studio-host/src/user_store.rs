use serde_json::Value;
use std::{io::Write, path::PathBuf, sync::Mutex};
const ERROR: &str = "BLK-SET-001";
pub struct UserStore {
    root: PathBuf,
    lock: Mutex<()>,
}
impl UserStore {
    pub fn new(root: PathBuf) -> Self {
        Self {
            root,
            lock: Mutex::new(()),
        }
    }
    fn path(&self, kind: &str, id: &str) -> Result<PathBuf, String> {
        if ![
            "settings",
            "shortcuts",
            "resources",
            "session",
            "window",
            "recovery",
        ]
        .contains(&kind)
            || !crate::project_store::stable(id)
        {
            return Err(ERROR.into());
        }
        Ok(self.root.join(kind).join(format!("{id}.json")))
    }
    pub fn read(&self, kind: &str, id: &str) -> Result<Option<Value>, String> {
        let _guard = self.lock.lock().map_err(|_| ERROR)?;
        let path = self.path(kind, id)?;
        if !path.exists() {
            return Ok(None);
        }
        if std::fs::metadata(&path).map_err(|_| ERROR)?.len() > 8 * 1024 * 1024 {
            return Err(ERROR.into());
        }
        let value = crate::strict_json::parse(&std::fs::read(path).map_err(|_| ERROR)?)?;
        validate(kind, &value)?;
        Ok(Some(value))
    }
    pub fn write(&self, kind: &str, id: &str, value: Value) -> Result<(), String> {
        let _guard = self.lock.lock().map_err(|_| ERROR)?;
        let path = self.path(kind, id)?;
        validate(kind, &value)?;
        let bytes = serde_json::to_vec(&value).map_err(|_| ERROR)?;
        if bytes.len() > 8 * 1024 * 1024 {
            return Err(ERROR.into());
        }
        let parent = path.parent().ok_or(ERROR)?;
        std::fs::create_dir_all(parent).map_err(|_| ERROR)?;
        let mut temporary = tempfile::NamedTempFile::new_in(parent).map_err(|_| ERROR)?;
        temporary
            .write_all(&bytes)
            .and_then(|_| temporary.as_file().sync_all())
            .map_err(|_| ERROR)?;
        temporary.persist(&path).map_err(|_| ERROR)?;
        Ok(())
    }
    pub fn clear(&self, kind: &str, id: &str) -> Result<(), String> {
        let _guard = self.lock.lock().map_err(|_| ERROR)?;
        let path = self.path(kind, id)?;
        if path.exists() {
            std::fs::remove_file(path).map_err(|_| ERROR)?;
        }
        Ok(())
    }
}
pub fn validate_settings(value: &Value) -> Result<(), String> {
    let map = value.as_object().ok_or(ERROR)?;
    if value["schemaVersion"] != "blocky.settings/v1"
        || !["app", "project"].contains(&value["scope"].as_str().unwrap_or(""))
        || map
            .keys()
            .any(|k| !["schemaVersion", "scope", "values"].contains(&k.as_str()))
    {
        return Err(ERROR.into());
    }
    for (key, value_item) in value["values"].as_object().ok_or(ERROR)? {
        if value["scope"] == "project" && key != "terminal.outputBudgetBytes" {
            return Err(ERROR.into());
        }
        let valid = match key.as_str() {
            "ui.reduceMotion" | "window.minimizeToTray" => value_item.is_boolean(),
            "ui.view" => matches!(value_item.as_str(), Some("beginner" | "professional")),
            "terminal.outputBudgetBytes" => value_item
                .as_u64()
                .is_some_and(|v| (256..=16777216).contains(&v)),
            "logs.retentionDays" => value_item.as_u64().is_some_and(|v| v <= 365),
            "logs.maxStoredBytes" => value_item
                .as_u64()
                .is_some_and(|v| (1024..=1073741824).contains(&v)),
            _ => false,
        };
        if !valid {
            return Err(ERROR.into());
        }
    }
    Ok(())
}
fn validate(kind: &str, value: &Value) -> Result<(), String> {
    crate::project_store::check_secrets(value, 0)?;
    if kind == "settings" {
        return validate_settings(value);
    }
    if kind == "recovery" {
        if value["schemaVersion"] != "blocky.recovery/v1"
            || !value["updatedAt"].is_string()
            || !value["digest"].is_string()
        {
            return Err(ERROR.into());
        }
        let files: crate::project_store::ProjectFiles =
            serde_json::from_value(value["files"].clone()).map_err(|_| ERROR)?;
        crate::project_store::validate_files(&files)?;
        let manifest =
            crate::strict_json::parse(files.get("project.json").ok_or(ERROR)?.as_bytes())?;
        if value["projectId"] != manifest["projectId"] {
            return Err(ERROR.into());
        }
    }
    if !value.is_object() {
        return Err(ERROR.into());
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn native_scoped_settings_are_atomic_and_invalid_input_preserves_saved_values() {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../try/stage2-store");
        std::fs::create_dir_all(&root).unwrap();
        let dir = tempfile::tempdir_in(root).unwrap();
        let store = UserStore::new(dir.path().to_owned());
        let value = serde_json::json!({"schemaVersion":"blocky.settings/v1","scope":"app","values":{"ui.reduceMotion":true}});
        store.write("settings", "app", value.clone()).unwrap();
        assert_eq!(store.read("settings", "app").unwrap(), Some(value.clone()));
        assert!(store.write("settings","app",serde_json::json!({"schemaVersion":"blocky.settings/v1","scope":"project","values":{"ui.reduceMotion":true}})).is_err());
        assert!(store.write("settings", "../escape", value.clone()).is_err());
        assert_eq!(store.read("settings", "app").unwrap(), Some(value));
    }
}
