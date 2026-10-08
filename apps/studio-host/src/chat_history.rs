use serde_json::{Value, json};
const ERROR: &str = "BLK-SET-001";
fn keys(value: &Value, expected: &[&str]) -> Result<(), String> {
    let fields = value.as_object().ok_or(ERROR)?;
    if fields.len() != expected.len() || fields.keys().any(|k| !expected.contains(&k.as_str())) {
        return Err(ERROR.into());
    }
    Ok(())
}
fn thread(value: &Value) -> Result<&str, String> {
    keys(value, &["id", "title", "createdAt", "updatedAt"])?;
    let id = value["id"].as_str().ok_or(ERROR)?;
    let title = value["title"].as_str().ok_or(ERROR)?;
    if !crate::project_store::stable(id) || title.trim().is_empty() || title.chars().count() > 180 {
        return Err(ERROR.into());
    }
    for key in ["createdAt", "updatedAt"] {
        let date = value[key].as_str().ok_or(ERROR)?;
        if date.len() != 24
            || !date.bytes().enumerate().all(|(i, b)| match i {
                4 | 7 => b == b'-',
                10 => b == b'T',
                13 | 16 => b == b':',
                19 => b == b'.',
                23 => b == b'Z',
                _ => b.is_ascii_digit(),
            })
        {
            return Err(ERROR.into());
        }
    }
    Ok(id)
}
fn activity(value: &Value) -> Result<(), String> {
    let fields = value.as_object().ok_or(ERROR)?;
    if fields.keys().any(|key| {
        !["callId", "tool", "status", "code", "command", "exitCode"].contains(&key.as_str())
    }) || !value["callId"]
        .as_str()
        .is_some_and(|id| !id.is_empty() && id.encode_utf16().count() <= 128)
        || !matches!(
            value["tool"].as_str(),
            Some(
                "workspace_list"
                    | "workspace_search"
                    | "workspace_read"
                    | "workspace_write"
                    | "workspace_undo"
                    | "workspace_check"
                    | "blocky_cli"
                    | "project_context"
            )
        )
        || !matches!(
            value["status"].as_str(),
            Some("started" | "completed" | "failed" | "cancelled")
        )
    {
        return Err(ERROR.into());
    }
    static CODE: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    static COMMAND: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    if fields.get("code").is_some_and(|value| {
        !value.as_str().is_some_and(|code| {
            code.len() <= 128
                && CODE
                    .get_or_init(|| {
                        regex::Regex::new(r"^BLK-[A-Z0-9-]+$").expect("fixed error code pattern")
                    })
                    .is_match(code)
        })
    }) || fields.get("command").is_some_and(|value| {
        !value.as_str().is_some_and(|command| {
            command.len() <= 96
                && COMMAND
                    .get_or_init(|| {
                        regex::Regex::new(
                            r"^(?:--version|[a-z][a-z0-9-]*(?: [a-z][a-z0-9-]*){0,2})$",
                        )
                        .expect("fixed command label pattern")
                    })
                    .is_match(command)
        })
    }) || fields.get("exitCode").is_some_and(|value| {
        !value
            .as_i64()
            .is_some_and(|code| i32::try_from(code).is_ok())
    }) {
        return Err(ERROR.into());
    }
    Ok(())
}
/// GUI archives carry safe auxiliary fields; the CLI's v1 text format stays strict.
fn messages(value: &Value) -> Result<(), String> {
    let messages = value["messages"].as_array().ok_or(ERROR)?;
    if serde_json::to_vec(messages).map_err(|_| ERROR)?.len() > crate::coding::HISTORY_BYTES {
        return Err(ERROR.into());
    }
    let projected: Vec<Value> = messages
        .iter()
        .map(|message| {
            let fields = message.as_object().ok_or(ERROR)?;
            Ok(Value::Object(
                fields
                    .iter()
                    .filter(|(key, _)| ["id", "role", "text", "status"].contains(&key.as_str()))
                    .map(|(key, value)| (key.clone(), value.clone()))
                    .collect(),
            ))
        })
        .collect::<Result<_, &str>>()?;
    crate::user_store::validate_chat(
        &json!({"schemaVersion":"blocky.coding-chat/v1","projectId":value["projectId"],"messages":projected}),
        true,
    )?;
    for message in messages {
        let fields = message.as_object().ok_or(ERROR)?;
        if fields.keys().any(|key| {
            ![
                "id",
                "role",
                "text",
                "status",
                "thinking",
                "thinkingTruncated",
                "activity",
                "activityTruncated",
                "runtimeActivity",
                "runtimeActivityTruncated",
            ]
            .contains(&key.as_str())
        }) || fields
            .get("thinkingTruncated")
            .is_some_and(|value| !value.is_boolean())
            || fields
                .get("activityTruncated")
                .is_some_and(|value| !value.as_u64().is_some_and(|count| count <= 65536))
            || fields.get("runtimeActivityTruncated").is_some_and(|value| !value.as_u64().is_some_and(|count| count <= 65536))
        {
            return Err(ERROR.into());
        }
        if let Some(thinking) = fields.get("thinking") {
            crate::coding::text_safe(thinking.as_str().ok_or(ERROR)?).map_err(|_| ERROR)?;
        }
        if let Some(items) = fields.get("activity") {
            let items = items.as_array().ok_or(ERROR)?;
            if items.len() > 200 {
                return Err(ERROR.into());
            }
            for item in items {
                activity(item)?;
            }
        }
        if let Some(items) = fields.get("runtimeActivity") {
            if value["assistant"] != "agent" { return Err(ERROR.into()); }
            let items = items.as_array().ok_or(ERROR)?;
            if items.len() > 200 { return Err(ERROR.into()); }
            for item in items {
                let fields = item.as_object().ok_or(ERROR)?;
                if fields.keys().any(|key| !["callId", "kind", "status", "toolId", "operation", "code"].contains(&key.as_str()))
                    || !matches!(item["kind"].as_str(), Some("tool" | "model"))
                    || !matches!(item["status"].as_str(), Some("started" | "completed" | "failed" | "cancelled")) {
                    return Err(ERROR.into());
                }
                for key in ["callId", "toolId", "operation"] {
                    if key == "callId" || fields.contains_key(key) {
                        if !item[key].as_str().is_some_and(|id| id.len() <= 128 && crate::project_store::stable(id)) { return Err(ERROR.into()); }
                    }
                }
                if let Some(code) = fields.get("code") {
                    if !code.as_str().is_some_and(|code| code.len() > 4 && code.len() <= 128 && code.starts_with("BLK-") && code[4..].chars().all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '-')) { return Err(ERROR.into()); }
                }
            }
        }
    }
    Ok(())
}
pub fn validate(kind: &str, value: &Value) -> Result<(), String> {
    if crate::builder::contains_credentials(value)
        || !value["projectId"]
            .as_str()
            .is_some_and(crate::project_store::stable)
        || !matches!(value["assistant"].as_str(), Some("builder" | "agent"))
    {
        return Err(ERROR.into());
    }
    if kind == "chat-conversation" {
        keys(
            value,
            &[
                "schemaVersion",
                "projectId",
                "assistant",
                "thread",
                "messages",
            ],
        )?;
        if value["schemaVersion"] != "blocky.chat-conversation/v1" {
            return Err(ERROR.into());
        }
        thread(&value["thread"])?;
        return messages(value);
    }
    keys(
        value,
        &[
            "schemaVersion",
            "projectId",
            "assistant",
            "activeId",
            "threads",
        ],
    )?;
    if value["schemaVersion"] != "blocky.chat-index/v1"
        || value["assistant"]
            != if kind == "chat-history-builder" {
                "builder"
            } else {
                "agent"
            }
    {
        return Err(ERROR.into());
    }
    let threads = value["threads"].as_array().ok_or(ERROR)?;
    if threads.is_empty() || threads.len() > 1000 {
        return Err(ERROR.into());
    }
    let mut ids = std::collections::HashSet::new();
    for item in threads {
        if !ids.insert(thread(item)?) {
            return Err(ERROR.into());
        }
    }
    if !ids.contains(value["activeId"].as_str().ok_or(ERROR)?) {
        return Err(ERROR.into());
    }
    Ok(())
}
pub fn binding(kind: &str, id: &str, value: &Value) -> Result<(), String> {
    let key = if kind == "chat-conversation" {
        &value["thread"]["id"]
    } else {
        &value["projectId"]
    };
    if key != id {
        return Err(ERROR.into());
    }
    Ok(())
}

#[cfg(test)]
mod tests;
