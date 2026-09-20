use serde_json::{json, Value};
use std::collections::BTreeMap;
const INVALID: &str = "BLK-SURFACE-002";
pub fn validate(
    manifest: &Value,
    files: &BTreeMap<String, Value>,
    project_manifest: &Value,
) -> Result<(), String> {
    let encoded = serde_json::to_string(&json!({"manifest": manifest, "files": files}))
        .map_err(|_| INVALID)?;
    if encoded.encode_utf16().count() > 100_000 {
        return Err(INVALID.into());
    }
    let id = manifest["surfaceId"].as_str().ok_or(INVALID)?;
    if !crate::project_store::stable(id) {
        return Err(INVALID.into());
    }
    let base = format!("surfaces/{id}");
    let module_id = manifest["associatedModuleIds"]
        .as_array()
        .filter(|a| a.len() == 1)
        .and_then(|a| a[0].as_str())
        .ok_or(INVALID)?;
    let name = manifest["displayName"]
        .as_str()
        .filter(|s| !s.is_empty() && s.encode_utf16().count() <= 100)
        .ok_or(INVALID)?;
    let version = manifest["schemaVersion"].as_str().ok_or(INVALID)?;
    if !["blocky.app-surface/v1alpha1", "blocky.app-surface/v1"].contains(&version) {
        return Err(INVALID.into());
    }
    let expected = json!({"schemaVersion":version,"surfaceId":id,"displayName":name,"sourceRootRef":format!("{base}/src"),"associatedModuleIds":[module_id],"bridgeRef":format!("{base}/bridge.json"),"permissions":["surface.preview","surface.invoke.ask"],"build":{"packageManager":"pnpm","lockfileRef":format!("{base}/pnpm-lock.yaml"),"outputRef":format!("{base}/dist")}});
    if manifest != &expected {
        return Err(INVALID.into());
    }
    let bridge = files.get(&format!("{base}/bridge.json")).ok_or(INVALID)?;
    let endpoint = bridge["endpoints"]
        .as_array()
        .filter(|a| a.len() == 1)
        .map(|a| &a[0])
        .ok_or(INVALID)?;
    let module = project_manifest["modules"]
        .as_array()
        .ok_or(INVALID)?
        .iter()
        .find(|m| m["moduleId"] == module_id)
        .ok_or(INVALID)?;
    let export = module["exports"]
        .as_array()
        .ok_or(INVALID)?
        .iter()
        .find(|e| e["exportId"] == endpoint["target"]["exportId"] && e["kind"] == "agent")
        .ok_or(INVALID)?;
    let mut expected_endpoint = json!({"endpointId":"ask","direction":"invoke","target":{"moduleId":module_id,"exportId":export["exportId"]},"approval":"never"});
    for field in ["inputSchemaRef", "outputSchemaRef"] {
        if let Some(value) = export.get(field) {
            expected_endpoint[field] = value.clone();
        }
    }
    if bridge
        != &json!({"schemaVersion":"blocky.frontend-bridge/v1alpha1","surfaceId":id,"endpoints":[expected_endpoint]})
    {
        return Err(INVALID.into());
    }
    let sources: Value = serde_json::from_str(include_str!(
        "../../../packages/app-surface/src/sources.json"
    ))
    .map_err(|_| INVALID)?;
    let mut expected_files = BTreeMap::new();
    if version == "blocky.app-surface/v1" {
        expected_files = crate::surface_spec::source_files(
            id,
            name,
            files
                .get(&format!("{base}/surface-spec.json"))
                .ok_or(INVALID)?,
        )?;
    } else {
        for (path, text) in sources["files"].as_object().ok_or(INVALID)? {
            let value = if path.ends_with(".json") {
                crate::strict_json::parse(text.as_str().ok_or(INVALID)?.as_bytes())?
            } else {
                text.clone()
            };
            expected_files.insert(format!("{base}/{path}"), value);
        }
    }
    expected_files.insert(format!("{base}/manifest.json"), manifest.clone());
    expected_files.insert(format!("{base}/bridge.json"), bridge.clone());
    if &expected_files != files {
        return Err(INVALID.into());
    }
    Ok(())
}
pub fn append(project: &mut Value, operation: &Value, approved: &[String]) -> Result<(), String> {
    if !approved.contains(&"surface.preview".to_string()) {
        return Err("BLK-SURFACE-001".into());
    }
    if !project["manifest"]["appSurfaces"]
        .as_array()
        .ok_or(INVALID)?
        .is_empty()
    {
        return Err(INVALID.into());
    }
    if operation
        .as_object()
        .ok_or(INVALID)?
        .keys()
        .any(|k| !["op", "manifest", "files"].contains(&k.as_str()))
    {
        return Err(INVALID.into());
    }
    let files: BTreeMap<String, Value> = operation["files"]
        .as_object()
        .ok_or(INVALID)?
        .iter()
        .map(|(k, v)| (k.clone(), v.clone()))
        .collect();
    validate(&operation["manifest"], &files, &project["manifest"])?;
    if operation["manifest"]["schemaVersion"] == "blocky.app-surface/v1" {
        project["manifest"]["format"]["minimumReaderVersion"] = json!("0.5.0");
    }
    let id = operation["manifest"]["surfaceId"].as_str().ok_or(INVALID)?;
    project["manifest"]["appSurfaces"]
        .as_array_mut()
        .ok_or(INVALID)?
        .push(json!({"surfaceId":id,"manifestRef":format!("surfaces/{id}/manifest.json")}));
    for (key, value) in files {
        project["surfaces"][key] = value;
    }
    Ok(())
}
