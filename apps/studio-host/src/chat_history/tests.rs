use super::*;
use crate::user_store::UserStore;

fn conversation() -> Value {
    json!({
        "schemaVersion":"blocky.chat-conversation/v1", "projectId":"sample", "assistant":"builder",
        "thread":{"id":"chat-one","title":"停止留痕","createdAt":"2026-10-09T01:00:00.000Z","updatedAt":"2026-10-09T01:01:00.000Z"},
        "messages":[{"id":"reply","role":"assistant","text":"已有正文保留。","status":"cancelled",
            "thinking":"已检查公开测试画布。", "thinkingTruncated":true,"activityTruncated":2,
            "activity":[
                {"callId":"call-one","tool":"project_context","status":"completed"},
                {"callId":"call-two","tool":"blocky_cli","status":"completed","command":"project compile","exitCode":0},
                {"callId":"call-three","tool":"blocky_cli","status":"failed","command":"patch apply","code":"BLK-CLI-COMMAND","exitCode":1},
                {"callId":"call-four","tool":"workspace_read","status":"cancelled"}
            ]}]
    })
}
fn store() -> (tempfile::TempDir, UserStore) {
    let parent =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../try/chat-history/store");
    std::fs::create_dir_all(&parent).unwrap();
    let root = tempfile::tempdir_in(parent).unwrap();
    let store = UserStore::new(root.path().to_owned());
    (root, store)
}

#[test]
fn native_archive_retains_thinking_and_tool_outcomes_without_changing_legacy() {
    let (_root, store) = store();
    let value = conversation();
    store
        .write("chat-conversation", "chat-one", value.clone())
        .unwrap();
    assert_eq!(
        store.read("chat-conversation", "chat-one").unwrap(),
        Some(value.clone())
    );
    let legacy = json!({"schemaVersion":"blocky.coding-chat/v1","projectId":"sample","messages":[
        {"id":"reply","role":"assistant","text":"已有正文保留。","status":"cancelled"}
    ]});
    store
        .write("coding-chat", "sample", legacy.clone())
        .unwrap();
    assert_eq!(store.read("coding-chat", "sample").unwrap(), Some(legacy));
    let mut invalid_legacy = json!({"schemaVersion":"blocky.coding-chat/v1","projectId":"sample","messages":value["messages"]});
    assert!(
        store
            .write("coding-chat", "sample", invalid_legacy.clone())
            .is_err()
    );
    invalid_legacy["schemaVersion"] = "blocky.builder-chat/v1".into();
    assert!(
        store
            .write("builder-chat", "sample", invalid_legacy)
            .is_err()
    );
    let plain = json!({"id":"user","role":"user","text":"旧文本会话"});
    let mut old = value.clone();
    old["messages"] = json!([plain]);
    store
        .write("chat-conversation", "chat-one", old.clone())
        .unwrap();
    assert_eq!(
        store.read("chat-conversation", "chat-one").unwrap(),
        Some(old)
    );
}

#[test]
fn malformed_or_sensitive_archive_metadata_cannot_replace_saved_history() {
    let (_root, store) = store();
    let valid = conversation();
    store
        .write("chat-conversation", "chat-one", valid.clone())
        .unwrap();
    let invalid_fields = [
        ("thinking", json!(123)),
        ("thinking", json!("public\0text")),
        ("thinking", json!("api_key = synthetic-credential-marker")),
        ("thinkingTruncated", json!("true")),
        ("activityTruncated", json!(-1)),
        ("activityTruncated", json!(65537)),
        ("activity", json!({})),
        ("unexpected", json!(true)),
    ];
    for (key, value) in invalid_fields {
        let mut invalid = valid.clone();
        invalid["messages"][0][key] = value;
        assert!(
            store
                .write("chat-conversation", "chat-one", invalid)
                .is_err(),
            "{key}"
        );
    }
    let invalid_activity = [
        ("callId", json!("")),
        ("callId", json!("a".repeat(129))),
        ("tool", json!("execute_shell")),
        ("status", json!("accepted")),
        ("command", json!("project compile --out private")),
        ("command", json!("project;other")),
        ("code", json!("OTHER")),
        ("exitCode", json!(2147483648_i64)),
        ("exitCode", json!(0.5)),
        ("arguments", json!("raw parameters")),
    ];
    for (key, value) in invalid_activity {
        let mut invalid = valid.clone();
        invalid["messages"][0]["activity"][0][key] = value;
        assert!(
            store
                .write("chat-conversation", "chat-one", invalid)
                .is_err(),
            "activity.{key}"
        );
    }
    let mut duplicate = valid.clone();
    duplicate["messages"]
        .as_array_mut()
        .unwrap()
        .push(valid["messages"][0].clone());
    assert!(
        store
            .write("chat-conversation", "chat-one", duplicate)
            .is_err()
    );
    assert!(
        store
            .write("chat-conversation", "chat-other", valid.clone())
            .is_err()
    );
    assert_eq!(
        store.read("chat-conversation", "chat-one").unwrap(),
        Some(valid)
    );
}

#[test]
fn archive_limits_include_auxiliary_fields_and_utf8_bytes() {
    let (_root, store) = store();
    let mut valid = conversation();
    valid["messages"][0]["thinking"] = json!("思".repeat(crate::coding::MESSAGE_BYTES / 3));
    store
        .write("chat-conversation", "chat-one", valid.clone())
        .unwrap();
    let mut too_long = valid.clone();
    too_long["messages"][0]["thinking"] = json!("思".repeat(crate::coding::MESSAGE_BYTES / 3 + 1));
    assert!(
        store
            .write("chat-conversation", "chat-one", too_long)
            .is_err()
    );
    let mut too_many = valid.clone();
    too_many["messages"][0]["activity"] =
        json!(vec![valid["messages"][0]["activity"][0].clone(); 201]);
    assert!(
        store
            .write("chat-conversation", "chat-one", too_many)
            .is_err()
    );
    let mut total = valid.clone();
    let mut second = valid["messages"][0].clone();
    second["id"] = "second".into();
    total["messages"].as_array_mut().unwrap().push(second);
    assert!(store.write("chat-conversation", "chat-one", total).is_err());
    assert_eq!(
        store.read("chat-conversation", "chat-one").unwrap(),
        Some(valid)
    );
}
