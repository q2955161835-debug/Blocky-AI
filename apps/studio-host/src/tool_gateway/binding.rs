use super::ToolRequest;
use crate::mcp_client::http::{HttpMode, HttpTransport};
use reqwest::{
    header::{HeaderMap, HeaderName, HeaderValue},
    Url,
};
use serde_json::{json, Value};
use std::{collections::BTreeMap, path::Path};
const CONFIG: &str = "BLK-TOOL-CONFIG";
#[derive(Default)]
struct SecretValues<'a>(BTreeMap<&'a str, String>);
impl<'a> std::ops::Deref for SecretValues<'a> {
    type Target = BTreeMap<&'a str, String>;
    fn deref(&self) -> &Self::Target {
        &self.0
    }
}
impl std::ops::DerefMut for SecretValues<'_> {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.0
    }
}
impl Drop for SecretValues<'_> {
    fn drop(&mut self) {
        for value in self.0.values_mut() {
            unsafe {
                crate::secret_store::wipe(value.as_bytes_mut());
            }
        }
    }
}
pub(crate) struct Binding {
    pub resource: Value,
    pub server: Value,
    pub adapter: String,
    pub digest: String,
    pub endpoint: Option<Url>,
    pub headers: HeaderMap,
    pub mode: HttpMode,
    pub input_schema: Option<Value>,
    pub output_schema: Option<Value>,
    pub launch: Option<super::bundle::Launch>,
    pub bundle_digest: Option<String>,
}
fn resource<'a>(registry: &'a Value, id: &str, kind: &str) -> Result<&'a Value, String> {
    let entries = registry["resources"].as_array().ok_or(CONFIG)?;
    let mut matched = entries.iter().filter(|v| v["resourceId"] == id);
    let entry = matched.next().ok_or(CONFIG)?;
    if matched.next().is_some()
        || entry["kind"] != kind
        || entry["scope"] != "user"
        || entry["definition"]["version"] != "1"
    {
        return Err(CONFIG.into());
    }
    Ok(entry)
}
fn permissions(resource: &Value, permission: &str) -> Result<(), String> {
    for field in [
        &resource["capabilityRequirements"],
        &resource["definition"]["permissions"],
    ] {
        if field
            .as_array()
            .is_none_or(|v| v.len() != 1 || v[0] != permission)
        {
            return Err("BLK-TOOL-PERMISSION".into());
        }
    }
    Ok(())
}
fn data_schema(definition: &Value, key: &str) -> Result<Value, String> {
    let text = definition[key]
        .as_str()
        .filter(|s| s.len() <= 16384)
        .ok_or(CONFIG)?;
    let value = crate::strict_json::parse(text.as_bytes()).map_err(|_| CONFIG)?;
    crate::provider::gateway::validate_data_schema(&value)?;
    Ok(value)
}
impl Binding {
    pub(crate) fn load(
        root: &Path,
        r: &ToolRequest,
        cancel: &dyn Fn() -> Result<(), String>,
    ) -> Result<Self, String> {
        r.validate()?;
        cancel()?;
        let registry = crate::user_store::UserStore::new(root.join("user"))
            .read("resources", "app")?
            .ok_or(CONFIG)?;
        let item = resource(
            &registry,
            &r.resource_id,
            if r.action == "call" { "tool" } else { "mcp" },
        )?;
        let d = &item["definition"];
        let adapter = d["implementationRef"]["id"]
            .as_str()
            .ok_or(CONFIG)?
            .to_owned();
        if d["implementationRef"]["kind"] != "adapter" {
            return Err(CONFIG.into());
        }
        let server = if r.action == "call" && adapter == "mcp-tool-v1" {
            resource(&registry, d["mcpResourceId"].as_str().ok_or(CONFIG)?, "mcp")?
        } else {
            item
        };
        if ![
            "http-json-v1",
            "search-json-v1",
            "mcp-tool-v1",
            "mcp-server-v1",
        ]
        .contains(&adapter.as_str())
            || (r.action == "call") == (adapter == "mcp-server-v1")
        {
            return Err(CONFIG.into());
        }
        let sd = &server["definition"];
        let mcp = adapter.starts_with("mcp-");
        let stdio = mcp && sd["transport"] == "stdio";
        if mcp
            && (sd["implementationRef"] != json!({"kind":"adapter","id":"mcp-server-v1"})
                || !["stdio", "streamable-http"].contains(&sd["transport"].as_str().unwrap_or("")))
        {
            return Err(CONFIG.into());
        }
        let permission = if stdio {
            "mcp.local"
        } else {
            "network.request"
        };
        permissions(item, permission)?;
        permissions(server, permission)?;
        if r.timeout_ms > sd["timeoutMs"].as_u64().ok_or(CONFIG)?
            || (r.action == "call" && r.timeout_ms > d["timeoutMs"].as_u64().ok_or(CONFIG)?)
        {
            return Err("BLK-TOOL-BUDGET".into());
        }
        let (input_schema, output_schema) = if r.action == "call" {
            let input = data_schema(d, "inputSchemaJson")?;
            crate::provider::gateway::validate_data(&r.input, &input)?;
            (Some(input), Some(data_schema(d, "outputSchemaJson")?))
        } else {
            (None, None)
        };
        if adapter == "mcp-tool-v1"
            && d["toolName"]
                .as_str()
                .is_none_or(|s| s.is_empty() || s.len() > 128 || s.chars().any(char::is_control))
        {
            return Err(CONFIG.into());
        }
        let secrets = crate::secret_store::SecretStore::new(root.join("secrets"));
        let mut values = SecretValues::default();
        let mut fingerprints = BTreeMap::new();
        for binding in server["secretBindings"].as_array().ok_or(CONFIG)? {
            let field = binding["fieldId"]
                .as_str()
                .filter(|s| ["endpoint", "headers", "launch"].contains(s))
                .ok_or(CONFIG)?;
            let id = binding["secretRef"].as_str().ok_or(CONFIG)?;
            if binding.as_object().is_none_or(|v| v.len() != 2)
                || values.contains_key(field)
                || sd.get(field).is_some()
            {
                return Err(CONFIG.into());
            }
            let (value, hash) = secrets.with_versioned_secret(id, |bytes| {
                String::from_utf8(bytes.to_vec()).map_err(|_| CONFIG)
            })?;
            values.insert(field, value?);
            fingerprints.insert(field, hash);
        }
        if adapter == "mcp-tool-v1"
            && item["secretBindings"]
                .as_array()
                .is_none_or(|v| !v.is_empty())
        {
            return Err(CONFIG.into());
        }
        let mode = match sd["networkMode"].as_str() {
            Some("remote") => HttpMode::Remote,
            Some("loopback") => HttpMode::Loopback,
            None if stdio => HttpMode::Loopback,
            _ => return Err(CONFIG.into()),
        };
        let mut headers = HeaderMap::new();
        let mut launch = None;
        let mut bundle_digest = None;
        let endpoint = if stdio {
            if values.len() != 1 {
                return Err(CONFIG.into());
            }
            let spec: super::bundle::Launch = serde_json::from_value(crate::strict_json::parse(
                values.get("launch").ok_or(CONFIG)?.as_bytes(),
            )?)
            .map_err(|_| CONFIG)?;
            bundle_digest = Some(spec.digest(cancel)?);
            launch = Some(spec);
            None
        } else {
            if values.contains_key("launch") {
                return Err(CONFIG.into());
            }
            let endpoint = Url::parse(values.get("endpoint").ok_or(CONFIG)?).map_err(|_| CONFIG)?;
            if let Some(text) = values.get("headers") {
                let value = crate::strict_json::parse(text.as_bytes()).map_err(|_| CONFIG)?;
                for (name, value) in value.as_object().ok_or(CONFIG)? {
                    let name = HeaderName::from_bytes(name.as_bytes()).map_err(|_| CONFIG)?;
                    let mut value =
                        HeaderValue::from_str(value.as_str().ok_or(CONFIG)?).map_err(|_| CONFIG)?;
                    value.set_sensitive(true);
                    if headers.insert(name, value).is_some() {
                        return Err(CONFIG.into());
                    }
                }
            }
            // Constructor validates destinations and reserved headers without connecting.
            HttpTransport::new(endpoint.clone(), headers.clone(), mode, r.timeout_ms)?;
            Some(endpoint)
        };
        if !mcp && !["GET", "POST"].contains(&d["method"].as_str().unwrap_or("")) {
            return Err(CONFIG.into());
        }
        let digest = crate::agent_data::digest(
            &json!({"request":r,"resource":item,"server":server,"versions":fingerprints,"bundleDigest":bundle_digest}),
        )?;
        Ok(Self {
            resource: item.clone(),
            server: server.clone(),
            adapter,
            digest,
            endpoint,
            headers,
            mode,
            input_schema,
            output_schema,
            launch,
            bundle_digest,
        })
    }
    pub(crate) fn preview(&self, r: &ToolRequest) -> Value {
        json!({"requestDigest":self.digest,"projectId":r.project_id,"runId":r.run_id,"requestId":r.request_id,"resourceId":r.resource_id,"action":r.action,"adapter":self.adapter,"serverId":self.server["resourceId"],"inputBytes":r.input.to_string().len(),"timeoutMs":r.timeout_ms,"localProcess":self.launch.is_some(),"networkMode":self.server["definition"]["networkMode"]})
    }
}
