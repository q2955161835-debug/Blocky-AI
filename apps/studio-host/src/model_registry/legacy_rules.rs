use super::ERROR;
use serde_json::{Value, json};
use std::collections::HashSet;
pub(super) fn validate(r: &Value, secrets: &HashSet<&str>, legacy: bool) -> Result<(), String> {
    let d = &r["definition"];
    let kind = r["kind"].as_str().ok_or(ERROR)?;
    let adapter = if d["implementationRef"]["kind"] == "adapter" {
        d["implementationRef"]["id"].as_str().unwrap_or("")
    } else {
        ""
    };
    let has = |key: &str| d.get(key).is_some();
    if d["chunking"].is_object()
        && d["chunking"]["overlap"]
            .as_f64()
            .is_some_and(|n| d["chunking"]["size"].as_f64().is_some_and(|size| n >= size))
    {
        return Err(ERROR.into());
    }
    if kind == "model" && !legacy {
        let builtin = matches!(
            (adapter, d["provider"].as_str(), d["protocol"].as_str()),
            ("generator-v1", Some("deterministic"), Some("local"))
                | ("deepseek-v1", Some("deepseek"), Some("openai-chat"))
                | ("xirang-v1", Some("xirang"), Some("openai-chat"))
        ) || (adapter == "local-score-v1"
            && d["provider"] == "local-cpu"
            && d["protocol"] == "local"
            && d["modelId"] == "ms-marco-minilm-l6-v2-int8-v1"
            && d["capabilities"] == json!(["rerank"])
            && secrets.is_empty()
            && !has("baseUrl"))
            || (adapter == "managed-local-v1"
                && d["provider"] == "managed-local"
                && d["protocol"] == "local"
                && d["modelId"] == "qwen3-0.6b-q8-v1"
                && secrets.is_empty());
        if (has("localRuntime") && d["provider"] != "managed-local")
            || (d["provider"] == "managed-local" && (!builtin || has("baseUrl")))
            || (!builtin && !has("baseUrl") && !secrets.contains("baseUrl"))
        {
            return Err(ERROR.into());
        }
    }
    if kind == "knowledge"
        && !legacy
        && ((!has("sourceRef") && d["sourceRefs"].as_array().is_none_or(|a| a.is_empty()))
            || !has("chunking")
            || !has("retrieval"))
    {
        return Err(ERROR.into());
    }
    let permissions = &d["permissions"];
    let caps = &r["capabilityRequirements"];
    if kind == "tool"
        && [
            "http-json-v1",
            "search-json-v1",
            "mcp-tool-v1",
            "module-tool-v1",
        ]
        .contains(&adapter)
    {
        for key in ["inputSchemaRef", "outputSchemaRef"] {
            if d[key]["kind"] != "schema" {
                return Err(ERROR.into());
            }
        }
        if !has("inputSchemaJson") || !has("outputSchemaJson") || !has("timeoutMs") {
            return Err(ERROR.into());
        }
        match adapter {
            "http-json-v1" | "search-json-v1" => {
                if permissions != &json!(["network.request"])
                    || caps != permissions
                    || !secrets.contains("endpoint")
                    || secrets.contains("access")
                    || !has("method")
                    || !has("networkMode")
                    || ["mcpResourceId", "toolName", "moduleId", "exportId"]
                        .iter()
                        .any(|k| has(k))
                {
                    return Err(ERROR.into());
                }
            }
            "mcp-tool-v1" => {
                if !has("mcpResourceId")
                    || !has("toolName")
                    || !secrets.is_empty()
                    || (!matches!(
                        permissions
                            .as_array()
                            .and_then(|a| a.first())
                            .and_then(Value::as_str),
                        Some("mcp.local" | "network.request")
                    ))
                    || permissions.as_array().is_none_or(|a| a.len() != 1)
                    || caps != permissions
                    || ["moduleId", "exportId", "method", "networkMode"]
                        .iter()
                        .any(|k| has(k))
                {
                    return Err(ERROR.into());
                }
            }
            _ => return Err(ERROR.into()), // module-tool is a project resource, never valid in a user ledger.
        }
    }
    if kind == "mcp" {
        if d["transport"] == "stdio" && (has("endpoint") || secrets.contains("endpoint"))
            || d["transport"] != "stdio" && !has("endpoint") && !secrets.contains("endpoint")
        {
            return Err(ERROR.into());
        }
        if adapter == "mcp-server-v1" {
            if !has("timeoutMs") {
                return Err(ERROR.into());
            }
            match d["transport"].as_str() {
                Some("stdio") => {
                    if permissions != &json!(["mcp.local"])
                        || caps != permissions
                        || !secrets.contains("launch")
                        || secrets.len() != 1
                        || has("networkMode")
                        || has("endpoint")
                    {
                        return Err(ERROR.into());
                    }
                }
                Some("streamable-http") => {
                    if permissions != &json!(["network.request"])
                        || caps != permissions
                        || !secrets.contains("endpoint")
                        || !has("networkMode")
                        || has("endpoint")
                        || secrets.iter().any(|k| !["endpoint", "headers"].contains(k))
                    {
                        return Err(ERROR.into());
                    }
                }
                _ => return Err(ERROR.into()),
            }
        }
    }
    Ok(())
}
