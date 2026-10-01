use serde_json::{Value, json};
use std::collections::HashSet;
const ERROR: &str = "BLK-MODEL-CONFIG";
const VERSION: &str = "blocky.resource-registry/v2";
mod legacy;
mod legacy_rules;
fn exact(value: &Value, fields: &[&str]) -> Result<(), String> {
    let m = value.as_object().ok_or(ERROR)?;
    if m.len() != fields.len() || m.keys().any(|k| !fields.contains(&k.as_str())) {
        return Err(ERROR.into());
    }
    Ok(())
}
fn id(value: &Value) -> Result<&str, String> {
    let s = value.as_str().ok_or(ERROR)?;
    if s.is_empty()
        || s.len() > 128
        || !s.bytes().next().unwrap().is_ascii_alphanumeric()
        || s.bytes()
            .any(|b| !b.is_ascii_alphanumeric() && !b"._-".contains(&b))
        || ["__proto__", "prototype", "constructor"].contains(&s)
        || s.starts_with("sk-")
        || s.starts_with("eyJ")
    {
        return Err(ERROR.into());
    }
    Ok(s)
}
fn name(value: &Value) -> Result<(), String> {
    let s = value.as_str().ok_or(ERROR)?;
    if s.trim().is_empty()
        || s.chars().count() > 2048
        || s.chars().any(char::is_control)
        || s.contains("http://")
        || s.contains("https://")
        || s.contains(":\\")
        || s.starts_with("\\\\")
        || regex::Regex::new(
            r"(?i)^(?:Bearer\s|sk-)|(?:api[_-]?key|authorization|password|cookie)\s*[:=]",
        )
        .unwrap()
        .is_match(s)
    {
        return Err(ERROR.into());
    }
    Ok(())
}
fn revision(v: &Value, minimum: u64) -> Result<u64, String> {
    v.as_u64()
        .filter(|n| (minimum..=2147483647).contains(n))
        .ok_or(ERROR.into())
}
fn provider(p: &Value) -> Result<(), String> {
    exact(
        p,
        &[
            "schemaVersion",
            "providerId",
            "displayName",
            "adapter",
            "protocol",
            "revision",
            "secretBindings",
        ],
    )?;
    id(&p["providerId"])?;
    name(&p["displayName"])?;
    revision(&p["revision"], 1)?;
    let adapter = p["adapter"].as_str().ok_or(ERROR)?;
    if p["schemaVersion"] != "blocky.model-provider/v1"
        || !["deepseek", "xirang", "openai-compatible", "ollama"].contains(&adapter)
        || p["protocol"] != "openai-chat"
    {
        return Err(ERROR.into());
    }
    let mut fields = HashSet::new();
    for b in p["secretBindings"].as_array().ok_or(ERROR)? {
        exact(b, &["fieldId", "secretRef"])?;
        id(&b["secretRef"])?;
        let f = b["fieldId"].as_str().ok_or(ERROR)?;
        if !["baseUrl", "apiKey", "headers"].contains(&f) || !fields.insert(f) {
            return Err(ERROR.into());
        }
    }
    if ["deepseek", "xirang"].contains(&adapter) {
        if fields.len() != 1 || !fields.contains("apiKey") {
            return Err(ERROR.into());
        }
    } else if !fields.contains("baseUrl") {
        return Err(ERROR.into());
    }
    Ok(())
}
fn connected_model(r: &Value) -> Result<(), String> {
    exact(
        r,
        &[
            "schemaVersion",
            "resourceId",
            "kind",
            "scope",
            "displayName",
            "definition",
            "capabilityRequirements",
            "secretBindings",
        ],
    )?;
    id(&r["resourceId"])?;
    name(&r["displayName"])?;
    if r["schemaVersion"] != "blocky.resource/v1alpha1"
        || r["kind"] != "model"
        || r["scope"] != "user"
        || r["secretBindings"].as_array().is_none_or(|a| !a.is_empty())
    {
        return Err(ERROR.into());
    }
    for c in r["capabilityRequirements"].as_array().ok_or(ERROR)? {
        id(c)?;
    }
    let d = &r["definition"];
    let m = d.as_object().ok_or(ERROR)?;
    if m.keys().any(|k| {
        ![
            "connectionRef",
            "modelId",
            "timeoutMs",
            "capabilities",
            "parameters",
        ]
        .contains(&k.as_str())
    }) {
        return Err(ERROR.into());
    }
    id(&d["connectionRef"])?;
    let model = d["modelId"].as_str().ok_or(ERROR)?;
    if model.is_empty()
        || model.len() > 128
        || model
            .bytes()
            .any(|b| !b.is_ascii_alphanumeric() && !b"-_.:/@".contains(&b))
        || d["timeoutMs"]
            .as_u64()
            .is_none_or(|n| !(1..=3600000).contains(&n))
    {
        return Err(ERROR.into());
    }
    let caps = d["capabilities"].as_array().ok_or(ERROR)?;
    if caps.len() > 1000
        || caps.iter().any(|c| {
            !matches!(
                c.as_str(),
                Some(
                    "text"
                        | "image"
                        | "audio"
                        | "tools"
                        | "structured-output"
                        | "embedding"
                        | "rerank"
                )
            )
        })
    {
        return Err(ERROR.into());
    }
    if let Some(params) = d.get("parameters") {
        for (k, v) in params.as_object().ok_or(ERROR)? {
            let n = v.as_f64().filter(|n| n.is_finite()).ok_or(ERROR)?;
            let valid = match k.as_str() {
                "temperature" => (0.0..=2.0).contains(&n),
                "topP" => (0.0..=1.0).contains(&n),
                "maxOutputTokens" => {
                    (1.0..=10000000.0).contains(&n) && v.is_u64()
                }
                _ => false,
            };
            if !valid {
                return Err(ERROR.into());
            }
        }
    }
    Ok(())
}
pub fn validate_registry(v: &Value) -> Result<(), String> {
    exact(v, &["schemaVersion", "revision", "providers", "resources"])?;
    if v["schemaVersion"] != VERSION {
        return Err(ERROR.into());
    }
    revision(&v["revision"], 0)?;
    let providers = v["providers"]
        .as_array()
        .filter(|a| a.len() <= 256)
        .ok_or(ERROR)?;
    let resources = v["resources"]
        .as_array()
        .filter(|a| a.len() <= 256)
        .ok_or(ERROR)?;
    let mut ids = HashSet::new();
    for p in providers {
        provider(p)?;
        if !ids.insert(id(&p["providerId"])?) {
            return Err(ERROR.into());
        }
    }
    let mut resource_ids = HashSet::new();
    for r in resources {
        if !resource_ids.insert(id(&r["resourceId"])?) || r["scope"] != "user" {
            return Err(ERROR.into());
        }
        if r["definition"].get("connectionRevision").is_some() {
            return Err(ERROR.into());
        }
        if r["definition"].get("connectionRef").is_some() {
            connected_model(r)?;
            if !ids.contains(id(&r["definition"]["connectionRef"])?) {
                return Err(ERROR.into());
            }
        }
    }
    crate::project_store::check_secrets(v, 0)
}
pub fn resolve_resource(registry: &Value, resource_id: &str) -> Result<Value, String> {
    let mut r = registry["resources"]
        .as_array()
        .and_then(|a| a.iter().find(|r| r["resourceId"] == resource_id))
        .cloned()
        .ok_or(ERROR)?;
    if registry["schemaVersion"] == VERSION {
        validate_registry(registry)?;
    } else if registry["schemaVersion"] == "blocky.resource-registry/v1" {
        return legacy::resolve(registry,r);
    } else if r["definition"].get("connectionRef").is_some() {
        return Err(ERROR.into());
    }
    if let Some(connection) = r["definition"]["connectionRef"].as_str() {
        let p = registry["providers"]
            .as_array()
            .and_then(|a| a.iter().find(|p| p["providerId"] == connection))
            .ok_or(ERROR)?;
        let adapter = p["adapter"].as_str().ok_or(ERROR)?;
        r["definition"]["provider"] = p["adapter"].clone();
        r["definition"]["protocol"] = p["protocol"].clone();
        r["definition"]["implementationRef"] =
            json!({"kind":"adapter","id":format!("{adapter}-v1")});
        r["definition"]["connectionRevision"] = p["revision"].clone();
        r["secretBindings"] = p["secretBindings"].clone();
    }
    Ok(r)
}
mod store;
pub use store::{rollback, write_registry};
#[cfg(test)]
mod tests;
