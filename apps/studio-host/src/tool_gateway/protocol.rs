use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
const INVALID: &str = "BLK-TOOL-INVALID";
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ToolRequest {
    pub schema_version: String,
    pub project_id: String,
    pub run_id: String,
    pub request_id: String,
    pub resource_id: String,
    pub action: String,
    pub input: Value,
    pub timeout_ms: u64,
}
pub fn stable(id: &str) -> bool {
    id.len() <= 128 && crate::project_store::stable(id)
}
impl ToolRequest {
    pub fn validate(&self) -> Result<(), String> {
        if self.schema_version != "blocky.tool-request/v2"
            || [
                &self.project_id,
                &self.run_id,
                &self.request_id,
                &self.resource_id,
            ]
            .iter()
            .any(|s| !stable(s))
            || !(1..=120000).contains(&self.timeout_ms)
            || !["call", "discover", "read-resource"].contains(&self.action.as_str())
        {
            return Err(INVALID.into());
        }
        crate::mcp_client::validate_json(&self.input, 32768)?;
        if self.action == "discover" && self.input != json!({}) {
            return Err(INVALID.into());
        }
        if self.action == "read-resource"
            && self.input.as_object().is_none_or(|o| {
                o.len() != 1
                    || self.input["uriRef"].as_str().is_none_or(|s| {
                        s.len() != 68
                            || !s.starts_with("uri-")
                            || !s[4..]
                                .bytes()
                                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
                    })
            })
        {
            return Err(INVALID.into());
        }
        Ok(())
    }
}
