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
        let request:GatewayRequest=serde_json::from_value(json!({"schemaVersion":"blocky.model-request/v2","requestId":request_id,"projectId":project_id,"resourceId":resource_id,"messages":[{"role":"user","content":"Blocky 构建会话"}],"tools":definitions,"toolChoice":"required","maxOutputTokens":1024,"timeoutMs":60000})).map_err(|_|ERROR)?;
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
            .as_u64()
            .unwrap_or(8192)
            .min(8192);
        let timeout = resource["definition"]["timeoutMs"]
            .as_u64()
            .unwrap_or(60000)
            .min(60000);
        let request: GatewayRequest = serde_json::from_value(json!({"schemaVersion":"blocky.model-request/v2","requestId":request_id,"projectId":project_id,"resourceId":resource_id,"messages":[{"role":"user","content":"Blocky 代码会话"}],"tools":definitions,"toolChoice":"auto","maxOutputTokens":max_output,"timeoutMs":timeout})).map_err(|_| ERROR)?;
        let preview = Binding::load(root, &request)?.preview(&request);
        Ok(Self::Gateway { request, preview })
    }
    pub(crate) fn max_output_tokens(&self) -> u32 {
        match self {
            Self::Legacy(r) => r.max_output_tokens,
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
                            image_refs:Vec::new(),
                        })
                    })
                    .collect::<Result<Vec<_>, String>>()?;
                request.validate()?;
                let mut result = super::gateway::execute(
                    root,
                    &request,
                    &bound,
                    cancel,
                    before_send,
                    &mut |bytes| {
                        *metadata =
                            crate::builder::evidence::response_metadata(bytes, &bound.provider);
                    },
                )?;
                let mut content = Vec::new();
                if result["text"].as_str().is_some_and(|s| !s.is_empty()) {
                    content.push(json!({"type":"text","text":result["text"]}));
                }
                for call in result["toolCalls"].as_array().ok_or(ERROR)? {
                    content.push(json!({"type":"toolCall","id":call["id"],"name":call["name"],"arguments":call["arguments"]}));
                }
                result.as_object_mut().ok_or(ERROR)?.remove("text");
                result.as_object_mut().ok_or(ERROR)?.remove("toolCalls");
                result["content"] = json!(content);
                Ok(result)
            }
        }
    }
}
