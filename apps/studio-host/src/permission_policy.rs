//! Desktop request confirmation preference. Capability and request validation
//! remain owned by each Host; this controls only the interactive prompt.
use crate::user_store::UserStore;

pub fn requires_confirmation(store: &UserStore) -> Result<bool, String> {
    let Some(doc) = store.read("ui-preferences", "app")? else { return Ok(false); };
    match doc["values"].get("permissionMode").and_then(|v| v.as_str()) {
        None | Some("full") => Ok(false),
        Some("ask") => Ok(true),
        _ => Err("BLK-UI-PREFERENCES".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn default_is_full_and_saved_mode_is_shared_after_reopen() {
        let dir = tempfile::tempdir().unwrap();
        let first = UserStore::new(dir.path().to_owned());
        let second = UserStore::new(dir.path().to_owned());
        assert!(!requires_confirmation(&first).unwrap());
        first.patch_ui_preferences("theme",json!("light")).unwrap();
        assert!(!requires_confirmation(&second).unwrap());
        first.patch_ui_preferences("permissionMode",json!("ask")).unwrap();
        assert!(requires_confirmation(&second).unwrap());
        let reopened = UserStore::new(dir.path().to_owned());
        assert!(requires_confirmation(&reopened).unwrap());
        second.patch_ui_preferences("permissionMode",json!("full")).unwrap();
        assert!(!requires_confirmation(&first).unwrap());
        assert_eq!(first.read("ui-preferences","app").unwrap().unwrap()["values"]["theme"],"light");
    }
    #[test]
    fn malformed_or_unknown_preferences_never_silently_grant_access() {
        let dir = tempfile::tempdir().unwrap();
        let store = UserStore::new(dir.path().to_owned());
        store.patch_ui_preferences("permissionMode",json!("ask")).unwrap();
        assert!(store.patch_ui_preferences("permissionMode",json!("anything")).is_err());
        assert!(requires_confirmation(&store).unwrap());
        let path = dir.path().join("ui-preferences/app.json");
        for bytes in ["{", r#"{"schemaVersion":"future","values":{}}"#,
            r#"{"schemaVersion":"blocky.ui-preferences/v1","values":{"permissionMode":"anything"}}"#] {
            std::fs::write(&path,bytes).unwrap();
            assert!(requires_confirmation(&store).is_err());
            assert_eq!(std::fs::read_to_string(&path).unwrap(),bytes);
        }
    }
}
