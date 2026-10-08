use super::{
    ProviderRequest,
    gateway::{GatewayRequest, ModelMessage, ToolCall, binding::Binding},
};
use serde_json::{Value, json};
use std::{path::Path, sync::atomic::AtomicBool};
const ERROR: &str = "BLK-BUILDER-WIRE";
#[derive(Clone)]
pub(crate) enum BuilderModel {
    Legacy(ProviderRequest),
    Gateway {
        request: GatewayRequest,
        preview: Value,
    },
}
impl BuilderModel {
    pub fn gateway(
        root: &Path,
        request_id: &str,
        project_id: &str,
        resource_id: &str,
        intent: &str,
    ) -> Result<Self, String> {
        let mut definitions: Vec<Value> = serde_json::from_str(include_str!(
            "../../../../packages/builder-engine/src/tool-schemas.json"
        ))
        .map_err(|_| ERROR)?;
        if intent == "explain" {
            definitions.retain(|tool| tool["name"] == "inspect" || tool["name"] == "draft");
            let draft = definitions
                .iter_mut()
                .find(|tool| tool["name"] == "draft")
                .ok_or(ERROR)?;
            draft["parameters"]["required"] = json!(["plan", "acceptanceCriteria", "explanation"]);
            draft["parameters"]["properties"]["explanation"]["minLength"] = json!(1);
        }
        let request:GatewayRequest=serde_json::from_value(json!({"schemaVersion":"blocky.model-request/v2","requestId":request_id,"projectId":project_id,"resourceId":resource_id,"messages":[{"role":"user","content":"Blocky 构建会话"}],"tools":definitions,"toolChoice":"required","timeoutMs":60000})).map_err(|_|ERROR)?;
        let mut request = request;
        let registry = crate::user_store::UserStore::new(root.join("user")).read("resources", "app")?.ok_or("BLK-MODEL-CONFIG")?;
        let resource = crate::model_registry::resolve_resource(&registry, resource_id)?;
        request.max_output_tokens = resource["definition"]["parameters"]["maxOutputTokens"].as_u64().map(|n|u32::try_from(n).map_err(|_| ERROR)).transpose()?;
        request.timeout_ms = resource["definition"]["timeoutMs"].as_u64().ok_or(ERROR)?;
        let preview = Binding::load(root, &request)?.preview(&request);
        Ok(Self::Gateway { request, preview })
    }
    pub(crate) fn coding(
        root: &Path,
        request_id: &str,
        project_id: &str,
        resource_id: &str,
    ) -> Result<Self, String> {
        let definitions: Value = serde_json::from_str(include_str!(
            "../../../../packages/builder-engine/src/coding-tool-schemas.json"
        ))
        .map_err(|_| ERROR)?;
        let registry = crate::user_store::UserStore::new(root.join("user"))
            .read("resources", "app")?
            .ok_or("BLK-MODEL-CONFIG")?;
        let resource = crate::model_registry::resolve_resource(&registry, resource_id)?;
        let max_output = resource["definition"]["parameters"]["maxOutputTokens"]
            .as_u64();
        let timeout = resource["definition"]["timeoutMs"]
            .as_u64()
            .unwrap_or(60000);
        let request: GatewayRequest = serde_json::from_value(json!({"schemaVersion":"blocky.model-request/v2","requestId":request_id,"projectId":project_id,"resourceId":resource_id,"messages":[{"role":"user","content":"Blocky 代码会话"}],"tools":definitions,"toolChoice":"auto","timeoutMs":timeout})).map_err(|_| ERROR)?;
        let mut request = request;
        request.max_output_tokens = max_output.map(|n| u32::try_from(n).map_err(|_| ERROR)).transpose()?;
        let preview = Binding::load(root, &request)?.preview(&request);
        Ok(Self::Gateway { request, preview })
    }
    pub(crate) fn with_reasoning(mut self, root: &Path, effort: Option<&str>) -> Result<Self, String> {
        if let Self::Gateway { request, preview } = &mut self {
            request.reasoning_effort = effort.map(str::to_owned);
            *preview = Binding::load(root, request)?.preview(request);
        } else if effort.is_some_and(|e| e != "none") { return Err("BLK-MODEL-CAPABILITY".into()); }
        Ok(self)
    }
    pub(crate) fn max_output_tokens(&self) -> Option<u32> {
        match self {
            Self::Legacy(r) => Some(r.max_output_tokens),
            Self::Gateway { request, .. } => request.max_output_tokens,
        }
    }
    pub fn digest(&self) -> Result<String, String> {
        match self {
            Self::Legacy(r) => r.digest(),
            Self::Gateway { preview, .. } => preview["requestDigest"]
                .as_str()
                .map(str::to_owned)
                .ok_or(ERROR.into()),
        }
    }
    pub fn provider(&self) -> &str {
        match self {
            Self::Legacy(r) => r.provider_name(),
            Self::Gateway { preview, .. } => preview["provider"].as_str().unwrap_or(""),
        }
    }
    pub fn model(&self) -> &str {
        match self {
            Self::Legacy(r) => &r.model_id,
            Self::Gateway { preview, .. } => preview["modelId"].as_str().unwrap_or(""),
        }
    }
    pub fn endpoint_label(&self) -> &str {
        match self {
            Self::Legacy(r) => r.endpoint(),
            Self::Gateway { .. } => "本机资源中配置的地址",
        }
    }
    pub fn destination(&self, root: &Path) -> Result<String, String> {
        match self {
            Self::Legacy(r) => Ok(r.endpoint().into()),
            Self::Gateway { request, preview } => super::ProviderHost::default().model_destination(
                root,
                request,
                preview["requestDigest"].as_str().ok_or(ERROR)?,
            ),
        }
    }
    pub fn generate(
        &self,
        root: &Path,
        messages: Value,
        remaining: u64,
        cancel: &AtomicBool,
        metadata: &mut Option<crate::builder::evidence::ResponseMetadata>,
        before_send: &mut dyn FnMut() -> Result<(), String>,
    ) -> Result<Value, String> {
        self.generate_inner(root, messages, remaining, cancel, metadata, before_send, None)
    }
    pub fn generate_stream(
        &self, root: &Path, messages: Value, remaining: u64, cancel: &AtomicBool,
        metadata: &mut Option<crate::builder::evidence::ResponseMetadata>,
        before_send: &mut dyn FnMut() -> Result<(), String>,
        on_delta: &mut dyn FnMut(Value) -> Result<(), String>,
    ) -> Result<Value, String> {
        self.generate_inner(root, messages, remaining, cancel, metadata, before_send, Some(on_delta))
    }
    fn generate_inner(
        &self, root: &Path, messages: Value, remaining: u64, cancel: &AtomicBool,
        metadata: &mut Option<crate::builder::evidence::ResponseMetadata>,
        before_send: &mut dyn FnMut() -> Result<(), String>,
        on_delta: Option<&mut dyn FnMut(Value) -> Result<(), String>>,
    ) -> Result<Value, String> {
        match self {
            Self::Legacy(r) => {
                let mut r = r.clone();
                r.timeout_ms = r.timeout_ms.min(remaining);
                super::builder::generate(root, &r, messages, cancel, metadata, before_send)
            }
            Self::Gateway { request, preview } => {
                if request.tools.iter().any(|t| t.name == "workspace_read") {
                    super::builder::validate_coding_messages(&messages)?;
                } else {
                    super::builder::validate_messages(&messages)?;
                }
                let bound = Binding::load(root, request)?;
                if preview["requestDigest"] != bound.digest {
                    return Err("BLK-PERM-001".into());
                }
                let mut request = request.clone();
                request.timeout_ms = request.timeout_ms.min(remaining);
                request.messages = messages
                    .as_array()
                    .ok_or(ERROR)?
                    .iter()
                    .map(|m| {
                        let calls = m
                            .get("tool_calls")
                            .and_then(Value::as_array)
                            .map(|calls| {
                                calls
                                    .iter()
                                    .map(|c| {
                                        Ok(ToolCall {
                                            id: c["id"].as_str().ok_or(ERROR)?.into(),
                                            name: c["function"]["name"]
                                                .as_str()
                                                .ok_or(ERROR)?
                                                .into(),
                                            arguments: crate::strict_json::parse(
                                                c["function"]["arguments"]
                                                    .as_str()
                                                    .ok_or(ERROR)?
                                                    .as_bytes(),
                                            )
                                            .map_err(|_| ERROR)?,
                                        })
                                    })
                                    .collect::<Result<Vec<_>, String>>()
                            })
                            .transpose()?
                            .unwrap_or_default();
                        Ok(ModelMessage {
                            role: m["role"].as_str().ok_or(ERROR)?.into(),
                            content: m["content"].as_str().unwrap_or("").into(),
                            tool_calls: calls,
                            tool_call_id: m["tool_call_id"].as_str().map(str::to_owned),
                            image_refs: Vec::new(),
                            reasoning_content: m["reasoning_content"].as_str().map(str::to_owned),
                        })
                    })
                    .collect::<Result<Vec<_>, String>>()?;
                request.validate()?;
                let result = super::gateway::execute_stream(
                    root,
                    &request,
                    &bound,
                    cancel,
                    before_send,
                    &mut |bytes| {
                        *metadata =
                            crate::builder::evidence::response_metadata(bytes, &bound.provider);
                    },
                    on_delta,
                )?;
                gateway_generation(result)
            }
        }
    }
}

fn gateway_generation(mut result: Value) -> Result<Value, String> {
    let mut content = Vec::new();
    if let Some(reasoning) = result["reasoningContent"].as_str().filter(|s|!s.is_empty()) { content.push(json!({"type":"thinking","thinking":reasoning})); }
    result.as_object_mut().ok_or(ERROR)?.remove("reasoningContent");
    if result["text"].as_str().is_some_and(|s| !s.is_empty()) {
        content.push(json!({"type":"text","text":result["text"]}));
    }
    for call in result["toolCalls"].as_array().ok_or(ERROR)? {
        content.push(json!({"type":"toolCall","id":call["id"],"name":call["name"],"arguments":call["arguments"]}));
    }
    result.as_object_mut().ok_or(ERROR)?.remove("text");
    result.as_object_mut().ok_or(ERROR)?.remove("toolCalls");
    // Gateway already checked completion semantics. Pi derives completion from
    // content; keep all remaining metadata for the existing strict schema.
    result.as_object_mut().ok_or(ERROR)?.remove("finishReason");
    result["content"] = json!(content);
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn gateway_response(tool: bool, usage: bool) -> Value {
        let request: GatewayRequest = serde_json::from_value(json!({
            "schemaVersion":"blocky.model-request/v2","requestId":"bridge1","projectId":"project1","resourceId":"model1",
            "messages":[{"role":"user","content":"synthetic bridge fixture"}],
            "tools":[{"name":"workspace_list","description":"List","parameters":{"type":"object"}}],
            "maxOutputTokens":512,"timeoutMs":1000
        })).unwrap();
        let mut response = json!({"id":"response1","model":"fixture-model","choices":[{
            "message":{"role":"assistant","content":"synthetic answer"},"finish_reason":"stop"
        }]});
        if tool {
            response["choices"][0]["message"]["tool_calls"] = json!([{"id":"call1","type":"function","function":{"name":"workspace_list","arguments":"{}"}}]);
            response["choices"][0]["finish_reason"] = json!("tool_calls");
        }
        if usage {
            response["usage"] = json!({"prompt_tokens":10,"completion_tokens":4,"total_tokens":14});
        }
        let mut result = super::super::gateway::parse_response(
            &serde_json::to_vec(&response).unwrap(),
            &request,
        )
        .unwrap();
        result["provider"] = json!("xirang");
        result["transport"] = json!("remote");
        result
    }
    #[test]
    fn gateway_bridge_consumes_wire_finish_reason_for_strict_generation_contract() {
        let result = gateway_generation(gateway_response(true, true)).unwrap();
        assert!(
            result.get("finishReason").is_none(),
            "Gateway transport completion is represented by content, not generation metadata: {result}"
        );
        assert_eq!(
            result["content"],
            json!([
                {"type":"text","text":"synthetic answer"},
                {"type":"toolCall","id":"call1","name":"workspace_list","arguments":{}}
            ])
        );
        assert_eq!(
            result["usage"],
            json!({"inputTokens":10,"outputTokens":4,"totalTokens":14})
        );
    }
    #[test]
    fn gateway_and_legacy_bridge_outputs_parse_the_production_typescript_contract() {
        let remote = gateway_generation(gateway_response(true, true)).unwrap();
        let mut local = gateway_response(false, false);
        local["provider"] = json!("managed-local");
        local["transport"] = json!("local");
        local["localInference"] = json!(true);
        local["externalApi"] = json!(false);
        let local = gateway_generation(local).unwrap();
        assert_eq!(local["usageStatus"], "unavailable");
        assert_eq!(local["usage"], Value::Null);
        assert_eq!(local["localInference"], true);
        assert_eq!(local["externalApi"], false);
        let legacy_wire = json!({"id":"legacy1","model":"legacy-model","choices":[{
            "message":{"role":"assistant","content":"legacy answer"},"finish_reason":"stop"
        }],"usage":{"prompt_tokens":8,"completion_tokens":3,"total_tokens":11}});
        let legacy =
            super::super::builder::parse_response(&serde_json::to_vec(&legacy_wire).unwrap(), 512)
                .unwrap();
        assert_eq!(legacy["transport"], "remote");
        assert_eq!(legacy["content"][0]["text"], "legacy answer");
        assert!(legacy.get("usageStatus").is_none());
        assert_contract(json!([remote, local, legacy]), true);
    }
    fn assert_contract(generations: Value, valid: bool) {
        // Run the exact strict schema consumed by coding.ts with real Rust
        // parser/bridge outputs, guarding changes on either language boundary.
        use std::{
            io::Write,
            process::{Command, Stdio},
        };
        let mut child = Command::new("node")
            .current_dir(Path::new(env!("CARGO_MANIFEST_DIR")).join("../.."))
            .args([
                "--import",
                "tsx",
                "--input-type=module",
                "-e",
                r#"
                import { codingResultSchema } from './packages/builder-protocol/src/index.ts';
                let input=''; for await (const chunk of process.stdin) input+=chunk;
                for (const generated of JSON.parse(input)) {
                    const { content, ...metadata } = generated;
                    codingResultSchema.shape.generations.element.parse(metadata);
                    if (!content.length) throw Error('Empty content');
                }
            "#,
            ])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("Production bridge contract test requires project Node/tsx dependencies");
        child
            .stdin
            .take()
            .unwrap()
            .write_all(&serde_json::to_vec(&generations).unwrap())
            .unwrap();
        let output = child.wait_with_output().unwrap();
        assert!(
            output.status.success() == valid,
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        if !valid {
            let error = String::from_utf8_lossy(&output.stderr);
            assert!(
                error.contains("unrecognized_keys") && error.contains("unexpected"),
                "{error}"
            );
        }
    }
    #[test]
    fn bridge_preserves_unknown_metadata_for_strict_typescript_rejection() {
        let mut wire = gateway_response(false, true);
        wire["unexpected"] = json!(true);
        let result = gateway_generation(wire).unwrap();
        assert_eq!(result["unexpected"], true);
        assert_contract(json!([result]), false);
    }
}
