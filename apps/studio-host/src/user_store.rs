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
            "builder-chat",
            "coding-chat",
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
        if ["builder-chat", "coding-chat"].contains(&kind) && value["projectId"] != id {
            return Err(ERROR.into());
        }
        Ok(Some(value))
    }
    pub fn write(&self, kind: &str, id: &str, value: Value) -> Result<(), String> {
        let _guard = self.lock.lock().map_err(|_| ERROR)?;
        let path = self.path(kind, id)?;
        validate(kind, &value)?;
        if kind == "resources" && id == "app" {
            return crate::model_registry::write_registry(&self.root, &value);
        }
        if ["builder-chat", "coding-chat"].contains(&kind) && value["projectId"] != id {
            return Err(ERROR.into());
        }
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
            "models.defaultResourceId" => value_item.as_str().is_some_and(|id| {
                id.is_empty()
                    || (id.len() <= 128
                        && crate::project_store::stable(id)
                        && !id.to_ascii_lowercase().starts_with("sk-")
                        && !["__proto__", "prototype", "constructor"].contains(&id))
            }),
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
    if kind == "resources" && value["schemaVersion"] == "blocky.resource-registry/v2" {
        return crate::model_registry::validate_registry(value);
    }
    if kind == "settings" {
        return validate_settings(value);
    }
    if ["builder-chat", "coding-chat"].contains(&kind) {
        return validate_chat(value, kind == "coding-chat");
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
fn validate_chat(value: &Value, coding: bool) -> Result<(), String> {
    if crate::builder::contains_credentials(value) {
        return Err(ERROR.into());
    }
    let map = value.as_object().ok_or(ERROR)?;
    let messages = value["messages"].as_array().ok_or(ERROR)?;
    if (coding
        && (value.to_string().len() > 8 * 1024 * 1024
            || serde_json::to_vec(messages).map_err(|_| ERROR)?.len() > crate::coding::HISTORY_BYTES))
        || value["schemaVersion"]
            != if coding {
                "blocky.coding-chat/v1"
            } else {
                "blocky.builder-chat/v1"
            }
        || !value["projectId"]
            .as_str()
            .is_some_and(crate::project_store::stable)
        || map
            .keys()
            .any(|key| !["schemaVersion", "projectId", "messages"].contains(&key.as_str()))
        || messages.len() > 40
    {
        return Err(ERROR.into());
    }
    let mut total = 0;
    let mut ids = std::collections::HashSet::new();
    for message in messages {
        let fields = message.as_object().ok_or(ERROR)?;
        let id = message["id"].as_str().ok_or(ERROR)?;
        let text = message["text"].as_str().ok_or(ERROR)?;
        let length = if coding { text.len() } else { text.chars().count() };
        total += length;
        if (coding && crate::coding::text_safe(text).is_err())
            || (if coding {
                id.is_empty()
                    || !id
                        .bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b))
            } else {
                !crate::project_store::stable(id)
            })
            || id.len() > 200
            || !ids.insert(id)
            || !matches!(message["role"].as_str(), Some("user" | "assistant"))
            || text.trim().is_empty()
            || length > if coding { crate::coding::MESSAGE_BYTES } else { 4000 }
            || total > if coding { crate::coding::HISTORY_BYTES } else { 64000 }
            || fields
                .keys()
                .any(|key| !["id", "role", "text", "status"].contains(&key.as_str()))
            || (!coding && message["status"] == "completed")
            || (coding && message["status"] == "explained")
            || fields.get("status").is_some_and(|status| {
                !matches!(
                    status.as_str(),
                    Some(
                        "completed"
                            | "proposed"
                            | "accepted"
                            | "rejected"
                            | "explained"
                            | "failed"
                            | "cancelled"
                            | "stale"
                    )
                )
            })
        {
            return Err(ERROR.into());
        }
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn coding_chat_is_strict_bounded_and_separate_from_builder_history() {
        let root = tempfile::tempdir().unwrap();
        let store = UserStore::new(root.path().to_owned());
        let value = serde_json::json!({"schemaVersion":"blocky.coding-chat/v1","projectId":"sample","messages":[{"id":"m_1","role":"assistant","text":"完成","status":"completed"}]});
        store.write("coding-chat", "sample", value.clone()).unwrap();
        assert_eq!(
            store.read("coding-chat", "sample").unwrap(),
            Some(value.clone())
        );
        assert!(store.write("coding-chat", "other", value.clone()).is_err());
        assert!(
            store
                .write("builder-chat", "sample", value.clone())
                .is_err()
        );
        let mut extra = value.clone();
        extra["workspaceId"] = serde_json::json!("workspace-unsafe");
        assert!(store.write("coding-chat", "sample", extra).is_err());
        let mut large = value.clone();
        large["messages"][0]["text"] = serde_json::json!("x".repeat(crate::coding::MESSAGE_BYTES + 1));
        assert!(store.write("coding-chat", "sample", large).is_err());
        let total = serde_json::json!({"schemaVersion":"blocky.coding-chat/v1","projectId":"sample","messages":(0..3).map(|id| serde_json::json!({"id":format!("m_{id}"),"role":"assistant","text":"x".repeat(1536 * 1024),"status":"completed"})).collect::<Vec<_>>()});
        assert!(store.write("coding-chat", "sample", total).is_err());
        let escaped_total = serde_json::json!({"schemaVersion":"blocky.coding-chat/v1","projectId":"sample","messages":(0..4).map(|id| serde_json::json!({"id":format!("escaped_{id}"),"role":"assistant","text":format!("line{}", "\n".repeat(600000)),"status":"completed"})).collect::<Vec<_>>()});
        assert!(store.write("coding-chat", "sample", escaped_total).is_err());
        assert_eq!(store.read("coding-chat", "sample").unwrap(), Some(value.clone()));
        let mut secret = value.clone();
        secret["messages"][0]["text"] =
            serde_json::json!("sk-abcdefghijklmnopqrstuvwxyz1234567890123456");
        assert!(store.write("coding-chat", "sample", secret).is_err());
    }
    #[test]
    fn coding_chat_preserves_long_unicode_answers_after_reopening_the_store() {
        let parent = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../try/agent-token-budgets/chat-store-tests");
        std::fs::create_dir_all(&parent).unwrap();
        let root = tempfile::tempdir_in(parent).unwrap();
        let store = UserStore::new(root.path().to_owned());
        let text = "知识🙂\n".repeat(150000);
        let value = serde_json::json!({"schemaVersion":"blocky.coding-chat/v1","projectId":"long-chat","messages":[{"id":"answer_1","role":"assistant","text":text,"status":"completed"}]});
        store.write("coding-chat", "long-chat", value.clone()).unwrap();
        drop(store);
        assert_eq!(UserStore::new(root.path().to_owned()).read("coding-chat", "long-chat").unwrap(), Some(value));
    }
    #[test]
    fn chat_is_project_bound_and_does_not_store_candidates_or_credentials() {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../try/agent-capability-upgrade/chat-store");
        std::fs::create_dir_all(&root).unwrap();
        let temp = tempfile::tempdir_in(root).unwrap();
        let store = UserStore::new(temp.path().to_owned());
        let chat = serde_json::json!({"schemaVersion":"blocky.builder-chat/v1","projectId":"classroom","messages":[{"id":"message-1","role":"assistant","text":"Public classroom example","status":"accepted"}]});
        store
            .write("builder-chat", "classroom", chat.clone())
            .unwrap();
        assert_eq!(
            store.read("builder-chat", "classroom").unwrap(),
            Some(chat.clone())
        );
        assert!(store.read("builder-chat", "other").unwrap().is_none());
        assert!(store.write("builder-chat", "other", chat.clone()).is_err());
        let mut extra = chat.clone();
        extra["patch"] = serde_json::json!({});
        assert!(store.write("builder-chat", "classroom", extra).is_err());
        let mut secret = chat.clone();
        secret["messages"][0]["text"] = format!("sk-{}", "a".repeat(32)).into();
        assert!(store.write("builder-chat", "classroom", secret).is_err());
        assert_eq!(store.read("builder-chat", "classroom").unwrap(), Some(chat));
    }
    #[test]
    fn default_model_reference_reopens_and_rejects_secret_text_and_project_scope() {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../try/default-model-store");
        std::fs::create_dir_all(&root).unwrap();
        let dir = tempfile::tempdir_in(root).unwrap();
        let value = serde_json::json!({"schemaVersion":"blocky.settings/v1","scope":"app","values":{"models.defaultResourceId":"saved-model"}});
        UserStore::new(dir.path().to_owned())
            .write("settings", "app", value.clone())
            .unwrap();
        let reopened = UserStore::new(dir.path().to_owned());
        assert_eq!(
            reopened.read("settings", "app").unwrap(),
            Some(value.clone())
        );
        for id in [
            "../secret",
            "https://example.com",
            "sk-do-not-store-a-key",
            "__proto__",
            "constructor",
        ] {
            let mut invalid = value.clone();
            invalid["values"]["models.defaultResourceId"] = id.into();
            assert!(reopened.write("settings", "app", invalid).is_err());
        }
        let mut invalid = value.clone();
        invalid["scope"] = "project".into();
        assert!(reopened.write("settings", "app", invalid).is_err());
        assert_eq!(reopened.read("settings", "app").unwrap(), Some(value));
    }
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
