use super::{GatewayRequest, validate_endpoint};
use crate::secret_store::SecretStore;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, path::Path};
const ERROR: &str = "BLK-MODEL-CONFIG";
pub(crate) struct Binding {
    pub provider: String,
    pub model: String,
    pub endpoint: Option<reqwest::Url>,
    pub local: bool,
    pub managed: Option<crate::local_models::LocalOptions>,
    pub key: Vec<u8>,
    pub headers: reqwest::header::HeaderMap,
    pub digest: String,
    pub parameters: Value,
}
impl Drop for Binding {
    fn drop(&mut self) {
        crate::secret_store::wipe(&mut self.key);
    }
}
impl Binding {
    pub fn load(root: &Path, r: &GatewayRequest) -> Result<Self, String> {
        r.validate()?;
        let registry = crate::user_store::UserStore::new(root.join("user"))
            .read("resources", "app")?
            .ok_or(ERROR)?;
        let resource = crate::model_registry::resolve_resource(&registry, &r.resource_id)?;
        let d = &resource["definition"];
        let provider = d["provider"]
            .as_str()
            .filter(|p| {
                [
                    "deepseek",
                    "xirang",
                    "openai-compatible",
                    "ollama",
                    "managed-local",
                ]
                .contains(p)
            })
            .ok_or(ERROR)?;
        let model = d["modelId"]
            .as_str()
            .filter(|s| {
                !s.is_empty()
                    && s.len() <= 128
                    && s.bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b"-_.:/@".contains(&b))
            })
            .ok_or(ERROR)?;
        if resource["scope"] != "user"
            || resource["kind"] != "model"
            || d["protocol"]
                != if provider == "managed-local" {
                    "local"
                } else {
                    "openai-chat"
                }
            || d["implementationRef"]["kind"] != "adapter"
            || d["implementationRef"]["id"] != format!("{provider}-v1")
        {
            return Err(ERROR.into());
        }
        let capabilities = d["capabilities"].as_array().ok_or(ERROR)?;
        if !capabilities.contains(&json!("text"))
            || (r.messages.iter().any(|m|!m.image_refs.is_empty())&&!capabilities.contains(&json!("image")))
            || (!r.tools.is_empty() && !capabilities.contains(&json!("tools")))
            || (r.output_schema.is_some() && !capabilities.contains(&json!("structured-output")))
        {
            return Err("BLK-MODEL-CAPABILITY".into());
        }
        super::images::validate(root,r)?;
        let timeout = d["timeoutMs"].as_u64().ok_or(ERROR)?;
        if r.timeout_ms > timeout.min(120000)
            || d["parameters"]["maxOutputTokens"]
                .as_u64()
                .is_some_and(|n| r.max_output_tokens as u64 > n)
        {
            return Err("BLK-MODEL-BUDGET".into());
        }
        let store = SecretStore::new(root.join("secrets"));
        let mut refs = BTreeMap::new();
        let mut fingerprints = BTreeMap::new();
        for b in resource["secretBindings"].as_array().ok_or(ERROR)? {
            let field = b["fieldId"]
                .as_str()
                .filter(|s| ["baseUrl", "apiKey", "headers"].contains(s))
                .ok_or(ERROR)?;
            let id = b["secretRef"].as_str().ok_or(ERROR)?;
            if b.as_object().is_none_or(|o| o.len() != 2)
                || refs.insert(field, id).is_some()
                || d.get(field).is_some()
            {
                return Err(ERROR.into());
            }
        }
        if provider == "managed-local" {
            if !refs.is_empty()
                || d.get("baseUrl").is_some()
                || model != crate::local_models::MODEL_ID
            {
                return Err(ERROR.into());
            }
            let options: crate::local_models::LocalOptions =
                serde_json::from_value(d.get("localRuntime").cloned().unwrap_or(json!({})))
                    .map_err(|_| ERROR)?;
            options.validate()?;
            let state = crate::local_models::status(root, model)?;
            if state["installed"] != true {
                return Err("BLK-LOCAL-MODEL-MISSING".into());
            }
            if state["backend"] != options.backend {
                return Err("BLK-LOCAL-MODEL-BACKEND".into());
            }
            let digest=format!("{:x}",Sha256::digest(serde_json::to_vec(&json!({"request":r,"resource":resource,"modelSha256":state["modelSha256"],"runtimeVersion":state["runtimeVersion"],"backend":state["backend"]})).map_err(|_|ERROR)?));
            return Ok(Self {
                provider: provider.into(),
                model: model.into(),
                endpoint: None,
                local: true,
                key: vec![],
                headers: reqwest::header::HeaderMap::new(),
                digest,
                managed: Some(options),
                parameters: d.get("parameters").cloned().unwrap_or(json!({})),
            });
        }
        let local = provider == "ollama";
        let mut endpoint = if ["deepseek", "xirang"].contains(&provider) {
            if refs.contains_key("baseUrl")
                || refs.contains_key("headers")
                || !refs.contains_key("apiKey")
            {
                return Err(ERROR.into());
            }
            let expected = if provider == "deepseek" {
                "https://api.deepseek.com"
            } else {
                "https://ai.ctaigw.cn"
            };
            if d.get("baseUrl").is_some_and(|v| {
                v.as_str().is_none_or(|s| {
                    ![
                        expected,
                        &format!("{expected}/"),
                        &format!("{expected}/v1"),
                        &format!("{expected}/v1/"),
                    ]
                    .contains(&s)
                })
            }) {
                return Err(ERROR.into());
            }
            validate_endpoint(&format!("{expected}/v1"), false)?
        } else {
            if d.get("baseUrl").is_some() {
                return Err(ERROR.into());
            }
            let (url, version) =
                store.with_versioned_secret(refs.get("baseUrl").ok_or(ERROR)?, |bytes| {
                    std::str::from_utf8(bytes)
                        .map_err(|_| ERROR.to_string())
                        .and_then(|v| validate_endpoint(v, local))
                })?;
            fingerprints.insert("baseUrl", version);
            url?
        };
        let path = format!("{}/chat/completions", endpoint.path().trim_end_matches('/'));
        endpoint.set_path(&path);
        let key = if let Some(id) = refs.get("apiKey") {
            let (key, version) = store.with_versioned_secret(id, |b| b.to_vec())?;
            fingerprints.insert("apiKey", version);
            key
        } else {
            vec![]
        };
        if key.len() > 8192
            || std::str::from_utf8(&key).is_err()
            || key.iter().any(|b| *b < 32 || *b == 127)
        {
            return Err(ERROR.into());
        }
        let mut headers = reqwest::header::HeaderMap::new();
        if let Some(id) = refs.get("headers") {
            let (parsed, version) =
                store.with_versioned_secret(id, |bytes| -> Result<(), String> {
                    let v = crate::strict_json::parse(bytes).map_err(|_| ERROR)?;
                    let map = v.as_object().filter(|m| m.len() <= 16).ok_or(ERROR)?;
                    for (name, value) in map {
                        let name = reqwest::header::HeaderName::from_bytes(name.as_bytes())
                            .map_err(|_| ERROR)?;
                        if !name.as_str().starts_with("x-") {
                            return Err(ERROR.into());
                        }
                        let text = value.as_str().filter(|s| s.len() <= 4096).ok_or(ERROR)?;
                        let mut value =
                            reqwest::header::HeaderValue::from_str(text).map_err(|_| ERROR)?;
                        value.set_sensitive(true);
                        headers.insert(name, value);
                    }
                    Ok(())
                })?;
            parsed?;
            fingerprints.insert("headers", version);
        }
        let digest = format!(
            "{:x}",
            Sha256::digest(
                serde_json::to_vec(
                    &json!({"request":r,"resource":resource,"bindings":fingerprints})
                )
                .map_err(|_| ERROR)?
            )
        );
        Ok(Self {
            provider: provider.into(),
            model: model.into(),
            endpoint: Some(endpoint),
            local,
            key,
            headers,
            digest,
            managed: None,
            parameters: d.get("parameters").cloned().unwrap_or(json!({})),
        })
    }
    pub fn preview(&self, r: &GatewayRequest) -> Value {
        json!({"requestDigest":self.digest,"provider":self.provider,"transport":if self.local{"local"}else{"remote"},"projectId":r.project_id,"resourceId":r.resource_id,"modelId":self.model,"inputBytes":r.messages.iter().map(|m|m.content.len()).sum::<usize>(),"imageCount":r.messages.iter().map(|m|m.image_refs.len()).sum::<usize>(),"toolNames":r.tools.iter().map(|t|&t.name).collect::<Vec<_>>(),"maxOutputTokens":r.max_output_tokens,"timeoutMs":r.timeout_ms})
    }
    pub fn body(&self, root:&Path, request:&GatewayRequest)->Result<Value,String>{
        let mut body=super::images::body(root,request,&self.model,&self.provider)?;
        for(key,wire,explicit,max)in [("temperature","temperature",request.temperature,2.0),("topP","top_p",request.top_p,1.0)] {
            if explicit.is_none() {if let Some(value)=self.parameters.get(key){
                let n=value.as_f64().filter(|n|n.is_finite()&&(0.0..=max).contains(n)).ok_or(ERROR)?;
                body[wire]=json!(n);
            }}
        }
        Ok(body)
    }
}
