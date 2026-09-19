use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
pub const ENDPOINT: &str = "https://api.deepseek.com/chat/completions";
pub const INVALID: &str = "BLK-PROVIDER-INVALID";
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProviderRequest {
    pub schema_version: String,
    pub request_id: String,
    pub project_id: String,
    pub resource_id: String,
    pub secret_ref: String,
    pub model_id: String,
    pub messages: Vec<Message>,
    pub max_output_tokens: u32,
    pub timeout_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub temperature: Option<f64>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Message {
    pub role: String,
    pub content: String,
}
impl ProviderRequest {
    pub fn validate(&self) -> Result<(), String> {
        if self.schema_version != "blocky.provider-request/v1"
            || [
                &self.request_id,
                &self.project_id,
                &self.resource_id,
                &self.secret_ref,
            ]
            .iter()
            .any(|s| s.len() > 128 || !crate::project_store::stable(s))
            || self.model_id.is_empty()
            || self.model_id.len() > 128
            || !self
                .model_id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"-_.".contains(&b))
            || !(1..=1024).contains(&self.max_output_tokens)
            || !(1..=120000).contains(&self.timeout_ms)
            || self
                .temperature
                .is_some_and(|t| !t.is_finite() || !(0.0..=2.0).contains(&t))
            || self.messages.is_empty()
            || self.messages.len() > 64
            || self.messages.iter().any(|m| {
                !["system", "user", "assistant"].contains(&m.role.as_str())
                    || m.content.is_empty()
                    || m.content.len() > 32768
            })
            || self.messages.iter().map(|m| m.content.len()).sum::<usize>() > 65536
        {
            return Err(INVALID.into());
        }
        Ok(())
    }
    pub fn digest(&self) -> Result<String, String> {
        self.validate()?;
        Ok(format!(
            "{:x}",
            Sha256::digest(serde_json::to_vec(self).map_err(|_| INVALID)?)
        ))
    }
    pub fn preflight(&self) -> Result<Value, String> {
        Ok(
            json!({"requestDigest":self.digest()?,"provider":"deepseek","endpoint":ENDPOINT,"projectId":self.project_id,"resourceId":self.resource_id,"modelId":self.model_id,"inputBytes":self.messages.iter().map(|m|m.content.len()).sum::<usize>(),"maxOutputTokens":self.max_output_tokens,"timeoutMs":self.timeout_ms}),
        )
    }
    pub fn body(&self) -> Value {
        let mut body = json!({"model":self.model_id,"messages":self.messages,"max_tokens":self.max_output_tokens,"stream":false,"thinking":{"type":"disabled"}});
        if let Some(t) = self.temperature {
            body["temperature"] = json!(t);
        }
        body
    }
}
pub fn check_binding(registry: &Value, r: &ProviderRequest) -> Result<(), String> {
    r.validate()?;
    let resource = registry["resources"]
        .as_array()
        .and_then(|a| a.iter().find(|v| v["resourceId"] == r.resource_id))
        .ok_or("BLK-PROVIDER-CONFIG")?;
    let d = &resource["definition"];
    let bindings = resource["secretBindings"]
        .as_array()
        .ok_or("BLK-PROVIDER-CONFIG")?;
    if resource["kind"] != "model"
        || resource["scope"] != "user"
        || d["provider"] != "deepseek"
        || d["protocol"] != "openai-chat"
        || d["modelId"] != r.model_id
        || d["baseUrl"].as_str().is_some_and(|s| {
            ![
                "https://api.deepseek.com",
                "https://api.deepseek.com/",
                "https://api.deepseek.com/v1",
                "https://api.deepseek.com/v1/",
            ]
            .contains(&s)
        })
        || bindings.len() != 1
        || bindings[0]["fieldId"] != "apiKey"
        || bindings[0]["secretRef"] != r.secret_ref
    {
        return Err("BLK-PROVIDER-CONFIG".into());
    }
    Ok(())
}
