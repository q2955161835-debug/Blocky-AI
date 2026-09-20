use serde::Deserialize;
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};
const INVALID: &str = "BLK-SURFACE-002";
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Spec {
    schema_version: String,
    title: String,
    description: String,
    layout: String,
    submit_label: String,
    result_label: String,
    attachment: bool,
    confirmation: bool,
    fields: Vec<Field>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Field {
    id: String,
    label: String,
    #[serde(rename = "type")]
    kind: String,
    required: bool,
    options: Vec<String>,
}
fn text(s: &str, max: usize) -> bool {
    !s.is_empty() && s.encode_utf16().count() <= max
}
pub fn source_files(id: &str, name: &str, spec: &Value) -> Result<BTreeMap<String, Value>, String> {
    let parsed: Spec = serde_json::from_value(spec.clone()).map_err(|_| INVALID)?;
    if parsed.schema_version != "blocky.surface-spec/v1"
        || parsed.title != name
        || !text(&parsed.title, 100)
        || parsed.description.encode_utf16().count() > 1000
        || !["stack", "split"].contains(&parsed.layout.as_str())
        || !text(&parsed.submit_label, 200)
        || !text(&parsed.result_label, 200)
        || parsed.fields.is_empty()
        || parsed.fields.len() > 12
    {
        return Err(INVALID.into());
    }
    let mut ids = BTreeSet::new();
    for f in &parsed.fields {
        let valid_id = !f.id.is_empty()
            && f.id.len() <= 40
            && f.id.as_bytes()[0].is_ascii_lowercase()
            && f.id
                .bytes()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-');
        if !valid_id
            || !ids.insert(&f.id)
            || !text(&f.label, 200)
            || !["text", "textarea", "select"].contains(&f.kind.as_str())
            || f.options.len() > 20
            || f.options.iter().any(|s| !text(s, 200))
            || (f.kind == "select" && f.options.is_empty())
            || (f.kind != "select" && !f.options.is_empty())
        {
            return Err(INVALID.into());
        }
        let _ = f.required;
    }
    let _ = (parsed.attachment, parsed.confirmation);
    let sources: Value = serde_json::from_str(include_str!(
        "../../../packages/app-surface/src/generated-sources.json"
    ))
    .map_err(|_| INVALID)?;
    let encoded = serde_json::to_string(spec)
        .map_err(|_| INVALID)?
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;");
    let mut files = BTreeMap::new();
    for (path, value) in sources["files"].as_object().ok_or(INVALID)? {
        let raw = value.as_str().ok_or(INVALID)?;
        let value = if path.ends_with(".json") {
            crate::strict_json::parse(raw.as_bytes())?
        } else {
            Value::String(raw.replace("<!--BLOCKY_SPEC-->", &encoded))
        };
        files.insert(format!("surfaces/{id}/{path}"), value);
    }
    files.insert(format!("surfaces/{id}/surface-spec.json"), spec.clone());
    Ok(files)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn typescript_generated_surface_roundtrip_and_tamper() {
        let fixture: Value = serde_json::from_str(include_str!(
            "../../../tests/contracts/fixtures/generated-surface.json"
        ))
        .unwrap();
        let draft = &fixture["draft"];
        let mut files: BTreeMap<String, Value> =
            serde_json::from_value(draft["files"].clone()).unwrap();
        crate::surface_guard::validate(&draft["manifest"], &files, &fixture["project"]["manifest"])
            .unwrap();
        files.insert(
            "surfaces/surface-generated-contract/src/page.js".into(),
            Value::String("fetch('https://example.com')".into()),
        );
        assert!(crate::surface_guard::validate(
            &draft["manifest"],
            &files,
            &fixture["project"]["manifest"]
        )
        .is_err());
    }
    #[test]
    fn surface_total_size_rejects_valid_but_oversized_fields() {
        let fixture: Value = serde_json::from_str(include_str!(
            "../../../tests/contracts/fixtures/generated-surface.json"
        ))
        .unwrap();
        let draft = &fixture["draft"];
        let id = draft["manifest"]["surfaceId"].as_str().unwrap();
        let name = draft["manifest"]["displayName"].as_str().unwrap();
        let mut spec = draft["files"][format!("surfaces/{id}/surface-spec.json")].clone();
        spec["fields"]=Value::Array((0..12).map(|i| serde_json::json!({"id":format!("field-{i}"),"label":"选择","type":"select","required":true,"options":vec!["x".repeat(200);20]})).collect());
        let mut files = source_files(id, name, &spec).unwrap();
        for suffix in ["manifest.json", "bridge.json"] {
            let path = format!("surfaces/{id}/{suffix}");
            files.insert(path.clone(), draft["files"][path].clone());
        }
        assert!(crate::surface_guard::validate(
            &draft["manifest"],
            &files,
            &fixture["project"]["manifest"]
        )
        .is_err());
    }
    #[test]
    fn utf16_limits_match_typescript() {
        let fixture: Value = serde_json::from_str(include_str!(
            "../../../tests/contracts/fixtures/generated-surface.json"
        ))
        .unwrap();
        let mut spec = fixture["draft"]["files"]
            ["surfaces/surface-generated-contract/surface-spec.json"]
            .clone();
        let name = "😀".repeat(51);
        spec["title"] = Value::String(name.clone());
        assert!(source_files("surface-test", &name, &spec).is_err());
        let name = "😀".repeat(50);
        spec["title"] = Value::String(name.clone());
        assert!(source_files("surface-test", &name, &spec).is_ok());
    }
}
