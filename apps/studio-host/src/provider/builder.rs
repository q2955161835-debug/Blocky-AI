use super::{transport, types, ProviderRequest};
use serde_json::{json, Value};
use std::{
    collections::BTreeSet,
    path::Path,
    sync::atomic::{AtomicBool, Ordering},
};
const ERROR: &str = "BLK-BUILDER-WIRE";
const TOOLS: [&str; 4] = ["inspect", "draft", "patch", "verify"];
fn fields(value: &Value, names: &[&str]) -> Result<(), String> {
    if value
        .as_object()
        .ok_or(ERROR)?
        .keys()
        .any(|k| !names.contains(&k.as_str()))
    {
        return Err(ERROR.into());
    }
    Ok(())
}
fn call(value: &Value) -> Result<(String, Value), String> {
    fields(value, &["id", "type", "function", "index"])?;
    if value
        .get("index")
        .is_some_and(|index| index.as_u64().is_none_or(|n| n >= 8))
    {
        return Err(ERROR.into());
    }
    fields(&value["function"], &["name", "arguments"])?;
    let id = value["id"]
        .as_str()
        .filter(|s| {
            !s.is_empty()
                && s.len() <= 128
                && s.bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b))
        })
        .ok_or(ERROR)?;
    let name = value["function"]["name"]
        .as_str()
        .filter(|s| TOOLS.contains(s))
        .ok_or(ERROR)?;
    let args = value["function"]["arguments"]
        .as_str()
        .filter(|s| s.len() <= 65536)
        .ok_or(ERROR)?;
    let args = crate::strict_json::parse(args.as_bytes()).map_err(|_| ERROR)?;
    if value["type"] != "function" || !args.is_object() {
        return Err(ERROR.into());
    }
    Ok((
        id.to_owned(),
        json!({"type":"toolCall","id":id,"name":name,"arguments":args}),
    ))
}
pub fn validate_messages(value: &Value) -> Result<(), String> {
    let messages = value
        .as_array()
        .filter(|a| !a.is_empty() && a.len() <= 32)
        .ok_or(ERROR)?;
    if value.to_string().len() > 131072 {
        return Err("BLK-BUILDER-BUDGET".into());
    }
    let mut pending = BTreeSet::new();
    let mut used = BTreeSet::new();
    for (index, message) in messages.iter().enumerate() {
        fields(message, &["role", "content", "tool_calls", "tool_call_id"])?;
        if message["content"].as_str().is_some_and(|s| s.len() > 65536) {
            return Err(ERROR.into());
        }
        match message["role"].as_str() {
            Some("system" | "user") => {
                if !pending.is_empty()
                    || message.get("tool_calls").is_some()
                    || message.get("tool_call_id").is_some()
                    || message["content"].as_str().is_none_or(|s| s.is_empty())
                    || (message["role"] == "system" && index != 0)
                {
                    return Err(ERROR.into());
                }
            }
            Some("assistant") => {
                if !pending.is_empty() || message.get("tool_call_id").is_some() {
                    return Err(ERROR.into());
                }
                if let Some(calls) = message.get("tool_calls") {
                    for value in calls
                        .as_array()
                        .filter(|a| !a.is_empty() && a.len() <= 8)
                        .ok_or(ERROR)?
                    {
                        let (id, _) = call(value)?;
                        if !used.insert(id.clone()) {
                            return Err(ERROR.into());
                        }
                        pending.insert(id);
                    }
                } else if message["content"].as_str().is_none_or(|s| s.is_empty()) {
                    return Err(ERROR.into());
                }
            }
            Some("tool") => {
                if message.get("tool_calls").is_some()
                    || !message["content"].is_string()
                    || !pending.remove(message["tool_call_id"].as_str().ok_or(ERROR)?)
                {
                    return Err(ERROR.into());
                }
            }
            _ => return Err(ERROR.into()),
        }
    }
    if !pending.is_empty() {
        return Err(ERROR.into());
    }
    Ok(())
}
pub fn tool_definitions() -> Result<Value, String> {
    let definitions: Value = serde_json::from_str(include_str!(
        "../../../../packages/builder-engine/src/tool-schemas.json"
    ))
    .map_err(|_| ERROR)?;
    Ok(Value::Array(
        definitions
            .as_array()
            .ok_or(ERROR)?
            .iter()
            .map(|v| json!({"type":"function","function":v}))
            .collect(),
    ))
}
pub fn parse_response(bytes: &[u8], max: u32) -> Result<Value, String> {
    let v = crate::strict_json::parse(bytes).map_err(|_| ERROR)?;
    let choice = &v["choices"][0];
    if v["choices"].as_array().is_none_or(|a| a.len() != 1)
        || choice["message"]["role"] != "assistant"
    {
        return Err(ERROR.into());
    }
    let mut content = Vec::new();
    if let Some(text) = choice["message"]["content"]
        .as_str()
        .filter(|s| !s.is_empty())
    {
        if text.len() > 65536 {
            return Err(ERROR.into());
        }
        content.push(json!({"type":"text","text":text}));
    }
    let mut ids = BTreeSet::new();
    if let Some(calls) = choice["message"].get("tool_calls").filter(|v| !v.is_null()) {
        if choice["finish_reason"] != "tool_calls" {
            return Err(ERROR.into());
        }
        for value in calls
            .as_array()
            .filter(|a| !a.is_empty() && a.len() <= 8)
            .ok_or(ERROR)?
        {
            let (id, parsed) = call(value)?;
            if !ids.insert(id) {
                return Err(ERROR.into());
            }
            content.push(parsed);
        }
    } else if choice["finish_reason"] != "stop" {
        return Err(ERROR.into());
    }
    if content.is_empty() {
        return Err(ERROR.into());
    }
    let model = v["model"]
        .as_str()
        .filter(|s| !s.is_empty() && s.len() <= 128 && !s.chars().any(char::is_control))
        .ok_or(ERROR)?;
    let id = v["id"]
        .as_str()
        .filter(|s| !s.is_empty() && s.len() <= 256 && !s.chars().any(char::is_control))
        .ok_or(ERROR)?;
    let input = v["usage"]["prompt_tokens"].as_u64().ok_or(ERROR)?;
    let output = v["usage"]["completion_tokens"].as_u64().ok_or(ERROR)?;
    let total = v["usage"]["total_tokens"].as_u64().ok_or(ERROR)?;
    if input > 10_000_000 || output > max as u64 || input.checked_add(output) != Some(total) {
        return Err(ERROR.into());
    }
    Ok(
        json!({"content":content,"model":model,"requestId":id,"provider":"deepseek","transport":"remote","usage":{"inputTokens":input,"outputTokens":output,"totalTokens":total}}),
    )
}
/// Only the trusted builder Host can supply the binding and the fixed tools.
pub fn generate(
    root: &Path,
    binding: &ProviderRequest,
    messages: Value,
    cancel: &AtomicBool,
    metadata: &mut Option<crate::builder::evidence::ResponseMetadata>,
    before_send: &mut dyn FnMut() -> Result<(), String>,
) -> Result<Value, String> {
    validate_messages(&messages)?;
    binding.validate()?;
    let registry = crate::user_store::UserStore::new(root.join("user"))
        .read("resources", "app")?
        .ok_or("BLK-PROVIDER-CONFIG")?;
    types::check_binding(&registry, binding)?;
    let mut body = binding.body();
    body["messages"] = messages;
    body["tools"] = tool_definitions()?;
    body["tool_choice"] = json!("auto");
    body["parallel_tool_calls"] = json!(false);
    let response = crate::secret_store::SecretStore::new(root.join("secrets")).with_secret(
        &binding.secret_ref,
        |key| {
            transport::send_raw_observed(
                binding.endpoint(),
                &body,
                binding.timeout_ms,
                key,
                cancel,
                before_send,
            )
        },
    )??;
    *metadata = crate::builder::evidence::response_metadata(&response, binding.provider_name());
    if cancel.load(Ordering::SeqCst) {
        return Err("BLK-BUILDER-CANCELLED".into());
    }
    let mut result = parse_response(&response, binding.max_output_tokens)?;
    result["provider"] = json!(binding.provider_name());
    Ok(result)
}
