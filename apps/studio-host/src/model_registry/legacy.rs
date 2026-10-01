//! Uses the same serialized field contract as the desktop, without resolving secrets or executing adapters.
use super::{ERROR, exact, id, name, provider};
use serde_json::Value;
use std::collections::HashSet;
fn field(value: &Value, schema: &Value, depth: usize) -> Result<(), String> {
    if depth > 16 {
        return Err(ERROR.into());
    }
    match schema["type"].as_str() {
        Some("object") => {
            let map = value.as_object().ok_or(ERROR)?;
            let properties = schema["properties"].as_object().ok_or(ERROR)?;
            if map.keys().any(|k| !properties.contains_key(k))
                || schema["required"].as_array().is_some_and(|required| {
                    required
                        .iter()
                        .any(|k| k.as_str().is_none_or(|k| !map.contains_key(k)))
                })
            {
                return Err(ERROR.into());
            }
            for (k, v) in map {
                field(v, &properties[k], depth + 1)?;
            }
        }
        Some("array") => {
            let list = value.as_array().filter(|v| v.len() <= 1000).ok_or(ERROR)?;
            for v in list {
                field(v, &schema["items"], depth + 1)?;
            }
        }
        Some("number") => {
            let n = value.as_f64().filter(|n| n.is_finite()).ok_or(ERROR)?;
            if schema["integer"] == true && value.as_i64().is_none() && value.as_u64().is_none()
                || schema["minimum"].as_f64().is_some_and(|min| n < min)
                || schema["maximum"].as_f64().is_some_and(|max| n > max)
            {
                return Err(ERROR.into());
            }
        }
        Some("boolean") => {
            if !value.is_boolean() {
                return Err(ERROR.into());
            }
        }
        Some("string") => {
            let s = value.as_str().ok_or(ERROR)?;
            let max = schema["maxLength"].as_u64().unwrap_or(2048) as usize;
            if s.trim().is_empty()
                || s.encode_utf16().count() > max
                || schema["enum"]
                    .as_array()
                    .is_some_and(|v| !v.contains(value))
            {
                return Err(ERROR.into());
            }
            match schema["format"].as_str() {
                Some("json-schema") => {
                    let json = crate::strict_json::parse(s.as_bytes())?;
                    bounded(&json, 0, &mut 0)?;
                }
                Some("public-https") => {
                    let url = reqwest::Url::parse(s).map_err(|_| ERROR)?;
                    let host = url.host_str().ok_or(ERROR)?;
                    if url.scheme() != "https"
                        || !url.username().is_empty()
                        || url.password().is_some()
                        || url.query().is_some()
                        || url.fragment().is_some()
                        || !host.contains('.')
                        || host.parse::<std::net::IpAddr>().is_ok()
                        || host.contains(':')
                        || [
                            "localhost",
                            "local",
                            "internal",
                            "home",
                            "lan",
                            "test",
                            "invalid",
                        ]
                        .iter()
                        .any(|suffix| host == *suffix || host.ends_with(&format!(".{suffix}")))
                    {
                        return Err(ERROR.into());
                    }
                }
                Some("id") => {
                    id(value)?;
                }
                _ => {
                    name(value)?;
                }
            }
        }
        _ => return Err(ERROR.into()),
    }
    Ok(())
}
fn bounded(value: &Value, depth: usize, nodes: &mut usize) -> Result<(), String> {
    *nodes += 1;
    if depth > 16 || *nodes > 1000 {
        return Err(ERROR.into());
    }
    match value {
        Value::String(s) if s.len() > 2048 || s.chars().any(|c| c < ' ') => {
            return Err(ERROR.into());
        }
        Value::Array(list) => {
            if list.len() > 1000 {
                return Err(ERROR.into());
            }
            for v in list {
                bounded(v, depth + 1, nodes)?;
            }
        }
        Value::Object(map) => {
            for (k, v) in map {
                if k.len() > 128 || ["__proto__", "prototype", "constructor"].contains(&k.as_str())
                {
                    return Err(ERROR.into());
                }
                bounded(v, depth + 1, nodes)?;
            }
        }
        _ => {}
    }
    Ok(())
}
pub(super) fn validate(value: &Value) -> Result<(), String> {
    exact(value, &["schemaVersion", "resources"])?;
    if value["schemaVersion"] != "blocky.resource-registry/v1" {
        return Err(ERROR.into());
    }
    let definitions: Value = serde_json::from_str(include_str!(
        "../../../../packages/resource-registry/src/definitions.host.json"
    ))
    .map_err(|_| ERROR)?;
    let resources = value["resources"]
        .as_array()
        .filter(|v| v.len() <= 256)
        .ok_or(ERROR)?;
    let mut ids = HashSet::new();
    for r in resources {
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
        if r["schemaVersion"] != "blocky.resource/v1alpha1"
            || r["scope"] != "user"
            || !ids.insert(id(&r["resourceId"])?)
        {
            return Err(ERROR.into());
        }
        name(&r["displayName"])?;
        field(
            &r["capabilityRequirements"],
            &serde_json::json!({"type":"array","items":{"type":"string","format":"id"}}),
            0,
        )?;
        let definition = definitions
            .as_array()
            .ok_or(ERROR)?
            .iter()
            .find(|d| d["kind"] == r["kind"])
            .ok_or(ERROR)?;
        let d = &r["definition"];
        let map = d.as_object().ok_or(ERROR)?;
        if map.contains_key("connectionRef") || map.contains_key("connectionRevision") {
            return Err(ERROR.into());
        }
        let mut fields = HashSet::new();
        for binding in r["secretBindings"]
            .as_array()
            .filter(|v| v.len() <= 1000)
            .ok_or(ERROR)?
        {
            exact(binding, &["fieldId", "secretRef"])?;
            id(&binding["secretRef"])?;
            let key = binding["fieldId"].as_str().ok_or(ERROR)?;
            if !definition["secretFields"]
                .as_array()
                .ok_or(ERROR)?
                .contains(&binding["fieldId"])
                || !fields.insert(key)
                || map.contains_key(key)
            {
                return Err(ERROR.into());
            }
        }
        let legacy = matches!(
            (r["kind"].as_str(), d["implementationRef"].as_str()),
            (Some("model"), Some("adapter://deterministic/composer-v1"))
                | (
                    Some("knowledge"),
                    Some("adapter://deterministic/knowledge-v1")
                )
        );
        if legacy {
            let allowed = if r["kind"] == "model" {
                vec!["implementationRef"]
            } else {
                vec!["implementationRef", "collection"]
            };
            if map.keys().any(|k| !allowed.contains(&k.as_str())) {
                return Err(ERROR.into());
            }
            if r["kind"] == "knowledge" {
                id(&d["collection"])?;
            }
        } else {
            field(d, &definition["definitionSchema"], 0)?;
        }
        super::legacy_rules::validate(r, &fields, legacy)?;
    }
    crate::project_store::check_secrets(value, 0)?;
    Ok(())
}
fn candidate(r: &Value) -> Option<Value> {
    let d = &r["definition"];
    let adapter = d["provider"].as_str()?;
    if r["kind"] != "model"
        || r["scope"] != "user"
        || !["deepseek", "xirang", "openai-compatible", "ollama"].contains(&adapter)
        || d["protocol"] != "openai-chat"
        || d.get("baseUrl").is_some()
        || d["implementationRef"]
            != serde_json::json!({"kind":"adapter","id":format!("{adapter}-v1")})
        || d.get("parameters").is_some_and(|p| {
            p.as_object().is_none_or(|p| {
                p.keys()
                    .any(|k| !["temperature", "topP", "maxOutputTokens"].contains(&k.as_str()))
            })
        })
    {
        return None;
    }
    let p = serde_json::json!({"schemaVersion":"blocky.model-provider/v1","providerId":format!("provider-{}",r["resourceId"].as_str()?),"displayName":adapter,"adapter":adapter,"protocol":"openai-chat","revision":1,"secretBindings":r["secretBindings"]});
    provider(&p).ok()?;
    Some(p)
}
fn bindings(p: &Value) -> std::collections::BTreeMap<String, Value> {
    p["secretBindings"]
        .as_array()
        .unwrap()
        .iter()
        .map(|b| {
            (
                b["fieldId"].as_str().unwrap().to_owned(),
                b["secretRef"].clone(),
            )
        })
        .collect()
}
pub(super) fn resolve(registry: &Value, mut resource: Value) -> Result<Value, String> {
    validate(registry)?;
    if let Some(own) = candidate(&resource) {
        let connection = registry["resources"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(candidate)
            .find(|p| p["adapter"] == own["adapter"] && bindings(p) == bindings(&own))
            .unwrap_or(own);
        resource["definition"]["connectionRef"] = connection["providerId"].clone();
        resource["definition"]["connectionRevision"] = serde_json::json!(1);
    }
    Ok(resource)
}
