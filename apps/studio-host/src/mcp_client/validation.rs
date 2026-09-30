use serde_json::Value;
pub(super) fn bounded(value: &Value, bytes: usize) -> Result<(), String> {
    if serde_json::to_vec(value)
        .map_err(|_| "BLK-MCP-PROTOCOL")?
        .len()
        > bytes
    {
        return Err("BLK-MCP-LIMIT".into());
    }
    fn visit(v: &Value, depth: usize, count: &mut usize) -> Result<(), String> {
        *count += 1;
        if depth > 32 || *count > 8192 {
            return Err("BLK-MCP-LIMIT".into());
        }
        match v {
            Value::Object(map) => {
                for item in map.values() {
                    visit(item, depth + 1, count)?;
                }
            }
            Value::Array(array) => {
                for item in array {
                    visit(item, depth + 1, count)?;
                }
            }
            _ => (),
        }
        Ok(())
    }
    visit(value, 0, &mut 0)
}
pub(super) fn optional_text(v: &Value, limit: usize) -> Result<&str, String> {
    v.as_str()
        .filter(|s| s.len() <= limit && !s.contains('\0'))
        .ok_or("BLK-MCP-PROTOCOL".into())
}
pub(super) fn text(v: &Value, limit: usize) -> Result<&str, String> {
    let s = optional_text(v, limit)?;
    if s.is_empty() || s.chars().any(char::is_control) {
        return Err("BLK-MCP-PROTOCOL".into());
    }
    Ok(s)
}
pub(super) fn schema(v: &Value) -> Result<(), String> {
    bounded(v, 16384)?;
    if !v.is_object() || v["type"] != "object" {
        return Err("BLK-MCP-SCHEMA".into());
    }
    fn refs(v: &Value) -> Result<(), String> {
        match v {
            Value::Object(map) => {
                if let Some(r) = map.get("$ref") {
                    if r.as_str().is_none_or(|s| !s.starts_with("#/")) {
                        return Err("BLK-MCP-SCHEMA".into());
                    }
                }
                for value in map.values() {
                    refs(value)?;
                }
            }
            Value::Array(array) => {
                for value in array {
                    refs(value)?;
                }
            }
            _ => (),
        }
        Ok(())
    }
    refs(v)
}
pub(super) fn resource(item: &Value) -> Result<(), String> {
    text(&item["uri"], 4096)?;
    if let Some(mime) = item.get("mimeType") {
        text(mime, 128)?;
    }
    if item.get("blob").is_some() {
        return Err("BLK-MCP-CONTENT".into());
    }
    optional_text(&item["text"], 131072)?;
    Ok(())
}
pub(super) fn content(item: &Value) -> Result<(), String> {
    match item["type"].as_str() {
        Some("text") => {
            optional_text(&item["text"], 131072)?;
        }
        Some("resource_link") => {
            text(&item["uri"], 4096)?;
            text(&item["name"], 256)?;
        }
        Some("resource") => resource(&item["resource"])?,
        _ => return Err("BLK-MCP-CONTENT".into()),
    }
    Ok(())
}
