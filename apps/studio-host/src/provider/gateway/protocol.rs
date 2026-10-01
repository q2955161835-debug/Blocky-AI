use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeSet;
pub const INVALID: &str = "BLK-MODEL-REQUEST";
pub const RESPONSE: &str = "BLK-MODEL-RESPONSE";

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GatewayRequest {
    pub schema_version: String,
    pub request_id: String,
    pub project_id: String,
    pub resource_id: String,
    pub messages: Vec<ModelMessage>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tools: Vec<ModelTool>,
    pub max_output_tokens: u32,
    pub timeout_ms: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub temperature: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output_schema: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_choice: Option<String>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ModelMessage {
    pub role: String,
    pub content: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tool_calls: Vec<ToolCall>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
    #[serde(default,skip_serializing_if="Vec::is_empty")]
    pub image_refs:Vec<ImageReference>,
}
#[derive(Clone,Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct ImageReference {pub media_id:String,pub sha256:String,pub version:u64}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ToolCall {
    pub id: String,
    pub name: String,
    pub arguments: Value,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ModelTool {
    pub name: String,
    pub description: String,
    pub parameters: Value,
}

fn token(s: &str, max: usize) -> bool {
    !s.is_empty()
        && s.len() <= max
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b))
}
fn metadata(s: Option<&str>, max: usize) -> Result<&str, String> {
    s.filter(|s| !s.is_empty() && s.len() <= max && !s.chars().any(char::is_control))
        .ok_or(RESPONSE.into())
}
fn fixed_builder_tool(tool: &ModelTool) -> bool {
    // The checked-in builder schemas include recursive workspace definitions. Only exact
    // copies qualify; arbitrary caller schemas still use the bounded subset below.
    static BUILTINS: std::sync::OnceLock<Vec<Value>> = std::sync::OnceLock::new();
    let definitions = BUILTINS.get_or_init(|| {
        serde_json::from_str(include_str!(
            "../../../../../packages/builder-engine/src/tool-schemas.json"
        ))
        .unwrap_or_default()
    });
    serde_json::to_value(tool).is_ok_and(|value| definitions.contains(&value))
}
/// Bounded JSON-schema subset shared with the runtime's structured output validator.
pub(super) fn schema(value: &Value, depth: usize) -> Result<(), String> {
    let o = value.as_object().ok_or(INVALID)?;
    if depth > 8
        || value.to_string().len() > 16384
        || o.keys().any(|k| {
            ![
                "type",
                "properties",
                "required",
                "additionalProperties",
                "items",
                "enum",
                "minimum",
                "maximum",
                "minLength",
                "maxLength",
                "minItems",
                "maxItems",
                "description",
            ]
            .contains(&k.as_str())
        })
    {
        return Err(INVALID.into());
    }
    let kind = value["type"].as_str().ok_or(INVALID)?;
    if ![
        "object", "array", "string", "number", "integer", "boolean", "null",
    ]
    .contains(&kind)
    {
        return Err(INVALID.into());
    }
    if let Some(props) = o.get("properties") {
        if kind != "object" {
            return Err(INVALID.into());
        }
        let props = props.as_object().filter(|p| p.len() <= 64).ok_or(INVALID)?;
        for (name, item) in props {
            if name.is_empty() || name.len() > 128 || name.chars().any(char::is_control) {
                return Err(INVALID.into());
            }
            schema(item, depth + 1)?;
        }
    }
    if let Some(items) = o.get("items") {
        if kind != "array" {
            return Err(INVALID.into());
        }
        schema(items, depth + 1)?;
    }
    if let Some(required) = o.get("required") {
        let required = required
            .as_array()
            .filter(|a| a.len() <= 64)
            .ok_or(INVALID)?;
        let mut seen = BTreeSet::new();
        for key in required {
            let key = key.as_str().ok_or(INVALID)?;
            if !seen.insert(key) || value["properties"].get(key).is_none() {
                return Err(INVALID.into());
            }
        }
    }
    if o.get("additionalProperties")
        .is_some_and(|v| !v.is_boolean())
    {
        return Err(INVALID.into());
    }
    if o.get("enum")
        .is_some_and(|v| v.as_array().is_none_or(|a| a.is_empty() || a.len() > 128))
    {
        return Err(INVALID.into());
    }
    for key in ["minimum", "maximum"] {
        if o.get(key)
            .is_some_and(|v| v.as_f64().is_none_or(|n| !n.is_finite()))
        {
            return Err(INVALID.into());
        }
    }
    for key in ["minLength", "maxLength", "minItems", "maxItems"] {
        if o.get(key)
            .is_some_and(|v| v.as_u64().is_none_or(|n| n > 65536))
        {
            return Err(INVALID.into());
        }
    }
    if o.get("description")
        .is_some_and(|v| v.as_str().is_none_or(|s| s.len() > 2048))
    {
        return Err(INVALID.into());
    }
    Ok(())
}
impl GatewayRequest {
    pub fn validate(&self) -> Result<(), String> {
        if self.schema_version != "blocky.model-request/v2"
            || [&self.request_id, &self.project_id, &self.resource_id]
                .iter()
                .any(|v| v.len() > 128 || !crate::project_store::stable(v))
            || !(1..=32768).contains(&self.max_output_tokens)
            || !(1..=120000).contains(&self.timeout_ms)
            || self
                .temperature
                .is_some_and(|t| !t.is_finite() || !(0.0..=2.0).contains(&t))
            || self.messages.is_empty()
            || self.messages.len() > 128
            || self.tools.len() > 32
            || serde_json::to_vec(self).map_err(|_| INVALID)?.len() > 262144
        {
            return Err(INVALID.into());
        }
        if self.tool_choice.as_deref().is_some_and(|choice| {
            !["auto", "required", "none"].contains(&choice)
                || (choice != "none" && self.tools.is_empty())
        }) {
            return Err(INVALID.into());
        }
        let mut names = BTreeSet::new();
        for tool in &self.tools {
            if !token(&tool.name, 64)
                || !names.insert(&tool.name)
                || tool.description.is_empty()
                || tool.description.len() > 2048
                || tool.parameters["type"] != "object"
            {
                return Err(INVALID.into());
            }
            if !fixed_builder_tool(tool) {
                schema(&tool.parameters, 0)?;
            }
        }
        if let Some(output) = &self.output_schema {
            schema(output, 0)?;
        }
        let mut pending = BTreeSet::new();
        let mut used = BTreeSet::new();
        let mut image_count=0;
        for (index, m) in self.messages.iter().enumerate() {
            if m.content.len() > 65536 || m.tool_calls.len() > 8 {
                return Err(INVALID.into());
            }
            image_count+=m.image_refs.len();
            if image_count>4||(!m.image_refs.is_empty()&&m.role!="user")||m.image_refs.iter().any(|r|!crate::project_store::stable(&r.media_id)||r.media_id.len()>128||r.version==0||r.version>9_007_199_254_740_991||r.sha256.len()!=64||!r.sha256.bytes().all(|b|b.is_ascii_digit()||(b'a'..=b'f').contains(&b))){return Err(INVALID.into());}
            match m.role.as_str() {
                "system" | "user"
                    if pending.is_empty()
                        && m.tool_calls.is_empty()
                        && m.tool_call_id.is_none()
                        && !m.content.is_empty()
                        && (m.role != "system" || index == 0) => {}
                "assistant"
                    if pending.is_empty()
                        && m.tool_call_id.is_none()
                        && (!m.content.is_empty() || !m.tool_calls.is_empty()) =>
                {
                    for call in &m.tool_calls {
                        if !token(&call.id, 128)
                            || !used.insert(call.id.clone())
                            || !names.contains(&call.name)
                            || !call.arguments.is_object()
                            || call.arguments.to_string().len() > 32768
                        {
                            return Err(INVALID.into());
                        }
                        pending.insert(call.id.clone());
                    }
                }
                "tool"
                    if m.tool_calls.is_empty()
                        && m.tool_call_id.as_ref().is_some_and(|id| pending.remove(id)) => {}
                _ => return Err(INVALID.into()),
            }
        }
        if !pending.is_empty() {
            return Err(INVALID.into());
        }
        Ok(())
    }
    pub fn body(&self, model: &str, provider: &str) -> Value {
        let messages:Vec<Value>=self.messages.iter().map(|m| {
            let mut v=json!({"role":m.role,"content":m.content});
            if !m.tool_calls.is_empty() {v["tool_calls"]=json!(m.tool_calls.iter().map(|t|json!({"id":t.id,"type":"function","function":{"name":t.name,"arguments":t.arguments.to_string()}})).collect::<Vec<_>>());}
            if let Some(id)=&m.tool_call_id {v["tool_call_id"]=json!(id);}
            v
        }).collect();
        let mut value = json!({"model":model,"messages":messages,"max_tokens":self.max_output_tokens,"stream":false});
        if let Some(t) = self.temperature {
            value["temperature"] = json!(t);
        }
        if !self.tools.is_empty() {
            value["tools"] = json!(self
                .tools
                .iter()
                .map(|t| json!({"type":"function","function":t}))
                .collect::<Vec<_>>());
            value["tool_choice"] = json!(self.tool_choice.as_deref().unwrap_or("auto"));
        }
        if let Some(schema) = &self.output_schema {
            value["response_format"] = json!({"type":"json_schema","json_schema":{"name":"blocky_output","strict":true,"schema":schema}});
        }
        if ["deepseek", "xirang"].contains(&provider) {
            value["thinking"] = json!({"type":"disabled"});
        }
        value
    }
}
pub fn parse_response(bytes: &[u8], request: &GatewayRequest) -> Result<Value, String> {
    if bytes.len() > 262144 {
        return Err(RESPONSE.into());
    }
    let value = crate::strict_json::parse(bytes).map_err(|_| RESPONSE)?;
    let choice = &value["choices"][0];
    if value["choices"].as_array().is_none_or(|a| a.len() != 1)
        || choice["message"]["role"] != "assistant"
    {
        return Err(RESPONSE.into());
    }
    let finish = choice["finish_reason"].as_str().ok_or(RESPONSE)?;
    if !["stop", "tool_calls"].contains(&finish) {
        return Err(if finish == "length" {
            "BLK-MODEL-TRUNCATED"
        } else {
            RESPONSE
        }
        .into());
    }
    let text = match &choice["message"]["content"] {
        Value::Null => "",
        Value::String(s) if s.len() <= 65536 => s,
        _ => return Err(RESPONSE.into()),
    };
    let mut calls = Vec::new();
    let mut ids = BTreeSet::new();
    if let Some(list) = choice["message"].get("tool_calls").filter(|v| !v.is_null()) {
        for call in list
            .as_array()
            .filter(|a| !a.is_empty() && a.len() <= 8)
            .ok_or(RESPONSE)?
        {
            let id = call["id"]
                .as_str()
                .filter(|id| token(id, 128))
                .ok_or(RESPONSE)?;
            let name = call["function"]["name"]
                .as_str()
                .filter(|name| request.tools.iter().any(|t| t.name == *name))
                .ok_or(RESPONSE)?;
            let args = call["function"]["arguments"]
                .as_str()
                .filter(|s| s.len() <= 32768)
                .ok_or(RESPONSE)?;
            let args = crate::strict_json::parse(args.as_bytes()).map_err(|_| RESPONSE)?;
            if call["type"] != "function" || !ids.insert(id) || !args.is_object() {
                return Err(RESPONSE.into());
            }
            calls.push(json!({"id":id,"name":name,"arguments":args}));
        }
    }
    if (finish == "tool_calls") != !calls.is_empty() || (text.is_empty() && calls.is_empty()) {
        return Err(RESPONSE.into());
    }
    if (request.tool_choice.as_deref() == Some("none") && !calls.is_empty())
        || (request.tool_choice.as_deref() == Some("required") && calls.is_empty())
    {
        return Err(RESPONSE.into());
    }
    if calls.is_empty() {
        if let Some(schema) = &request.output_schema {
            let data = crate::strict_json::parse(text.as_bytes())
                .map_err(|_| "BLK-MODEL-OUTPUT-SCHEMA")?;
            if !super::structured::matches(&data, schema, 0) {
                return Err("BLK-MODEL-OUTPUT-SCHEMA".into());
            }
        }
    }
    let model = metadata(value["model"].as_str(), 128)?;
    let id = metadata(value["id"].as_str(), 256)?;
    let usage = match value.get("usage").filter(|v| !v.is_null()) {
        None => Value::Null,
        Some(u) => {
            let input = u["prompt_tokens"].as_u64().ok_or(RESPONSE)?;
            let output = u["completion_tokens"].as_u64().ok_or(RESPONSE)?;
            let total = u["total_tokens"].as_u64().ok_or(RESPONSE)?;
            if input > 10_000_000
                || output > request.max_output_tokens as u64
                || input.checked_add(output) != Some(total)
            {
                return Err(RESPONSE.into());
            }
            json!({"inputTokens":input,"outputTokens":output,"totalTokens":total})
        }
    };
    Ok(
        json!({"schemaVersion":"blocky.model-response/v2","text":text,"toolCalls":calls,"finishReason":finish,"model":model,"requestId":id,"usageStatus":if usage.is_null(){"unavailable"}else{"reported"},"usage":usage}),
    )
}
