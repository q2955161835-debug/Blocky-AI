//! Desktop request confirmation preference. Capability and request validation
//! remain owned by each Host; this controls only the interactive prompt.
use crate::user_store::UserStore;

/// Shared Native request gate. A declined confirmation returns the same public
/// permission error as the callers, before any Host operation can start.
pub async fn authorize_request<F, Fut>(store: &UserStore, confirm: F) -> Result<(), String>
where
    F: FnOnce() -> Fut,
    Fut: std::future::Future<Output = bool>,
{
    if requires_confirmation(store)? && !confirm().await {
        return Err("BLK-PERM-001".into());
    }
    Ok(())
}

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
    #[tokio::test]
    async fn runtime_authorization_controls_confirmation_and_execution() {
        use std::cell::Cell;
        let dir = tempfile::tempdir().unwrap();
        let store = UserStore::new(dir.path().to_owned());
        for (mode, answer, expected_confirm, expected_execute) in [
            ("full", false, 0, 1),
            ("ask", false, 1, 0),
            ("ask", true, 1, 1),
        ] {
            store.patch_ui_preferences("permissionMode", json!(mode)).unwrap();
            let confirmations = Cell::new(0);
            let executions = Cell::new(0);
            let authorization = authorize_request(&store, || async {
                confirmations.set(confirmations.get() + 1);
                answer
            }).await;
            if authorization.is_ok() { executions.set(executions.get() + 1); }
            else { assert_eq!(authorization.unwrap_err(), "BLK-PERM-001"); }
            assert_eq!(confirmations.get(), expected_confirm, "mode {mode}, answer {answer}");
            assert_eq!(executions.get(), expected_execute, "mode {mode}, answer {answer}");
        }
        std::fs::write(dir.path().join("ui-preferences/app.json"), "{").unwrap();
        let confirmations = Cell::new(0);
        let executions = Cell::new(0);
        let authorization = authorize_request(&store, || async {
            confirmations.set(confirmations.get() + 1);
            true
        }).await;
        if authorization.is_ok() { executions.set(executions.get() + 1); }
        assert!(authorization.is_err());
        assert_eq!((confirmations.get(), executions.get()), (0, 0));
    }
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
