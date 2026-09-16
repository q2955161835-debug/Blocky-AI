use crate::{
    project_store::{self, ProjectFiles},
    strict_json,
};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;
const INVALID: &str = "BLK-PATCH-002";
fn array<'a>(v: &'a Value) -> Result<&'a Vec<Value>, String> {
    v.as_array().ok_or_else(|| INVALID.into())
}
fn text(v: &Value) -> Result<&str, String> {
    v.as_str().ok_or_else(|| INVALID.into())
}
fn keys(v: &Value, allowed: &[&str]) -> Result<(), String> {
    if v.as_object()
        .ok_or(INVALID)?
        .keys()
        .any(|k| !allowed.contains(&k.as_str()))
    {
        return Err(INVALID.into());
    }
    Ok(())
}
pub fn project_files(project: &Value) -> Result<ProjectFiles, String> {
    keys(
        project,
        &["manifest", "workspaces", "resources", "schemas", "surfaces"],
    )?;
    let mut files = ProjectFiles::new();
    files.insert("project.json".into(), project["manifest"].to_string());
    for m in array(&project["manifest"]["modules"])? {
        files.insert(
            text(&m["workspaceRef"])?.into(),
            project["workspaces"][text(&m["moduleId"])?].to_string(),
        );
    }
    for r in array(&project["manifest"]["resources"])? {
        if r["scope"] == "project" {
            files.insert(
                text(&r["definitionRef"])?.into(),
                project["resources"][text(&r["resourceId"])?].to_string(),
            );
        }
    }
    for field in ["schemas", "surfaces"] {
        for (path, value) in project[field].as_object().ok_or(INVALID)? {
            files.insert(path.clone(), value.to_string());
        }
    }
    project_store::validate_files(&files)?;
    Ok(files)
}
fn definition(kind: &str) -> Result<Value, String> {
    let catalog: Value = serde_json::from_str(include_str!(
        "../../../packages/block-catalog/src/definitions.json"
    ))
    .map_err(|_| INVALID)?;
    array(&catalog)?
        .iter()
        .find(|v| v["type"] == kind)
        .cloned()
        .ok_or_else(|| INVALID.into())
}
fn block_shape(
    block: &Value,
    ids: &mut BTreeSet<String>,
    strict: bool,
    depth: usize,
) -> Result<(), String> {
    if depth > 60 {
        return Err(INVALID.into());
    }
    if strict {
        keys(
            block,
            &[
                "type",
                "id",
                "fields",
                "inputs",
                "next",
                "x",
                "y",
                "disabled",
                "collapsed",
            ],
        )?;
    }
    let id = text(&block["id"])?;
    if !crate::project_store::stable(id) || !ids.insert(id.into()) {
        return Err(INVALID.into());
    }
    let def = definition(text(&block["type"])?)?;
    if let Some(fields) = block.get("fields") {
        for (key, value) in fields.as_object().ok_or(INVALID)? {
            if !array(&def["fields"])?.iter().any(|f| f == key)
                || value
                    .as_str()
                    .is_none_or(|s| s.is_empty() || s.len() > 64000)
            {
                return Err(INVALID.into());
            }
        }
    }
    for field in array(&def["fields"])? {
        text(&block["fields"][text(field)?])?;
    }
    if let Some(inputs) = block.get("inputs") {
        for (key, input) in inputs.as_object().ok_or(INVALID)? {
            if !array(&def["inputs"])?.iter().any(|f| f == key) {
                return Err(INVALID.into());
            }
            keys(input, &["block", "shadow"])?;
            for field in ["block", "shadow"] {
                if let Some(child) = input.get(field) {
                    block_shape(child, ids, strict, depth + 1)?;
                }
            }
        }
    }
    if let Some(next) = block.get("next") {
        keys(next, &["block"])?;
        block_shape(&next["block"], ids, strict, depth + 1)?;
    }
    for field in ["x", "y"] {
        if let Some(value) = block.get(field) {
            if value
                .as_f64()
                .is_none_or(|v| !v.is_finite() || v.abs() > 100000.0)
            {
                return Err(INVALID.into());
            }
        }
    }
    for field in ["disabled", "collapsed"] {
        if block.get(field).is_some_and(|v| !v.is_boolean()) {
            return Err(INVALID.into());
        }
    }
    Ok(())
}
fn find_mut<'a>(block: &'a mut Value, id: &str) -> Option<&'a mut Value> {
    if block["id"] == id {
        return Some(block);
    }
    let map = block.as_object_mut()?;
    for (key, value) in map {
        if key == "inputs" {
            for input in value.as_object_mut()?.values_mut() {
                for child in input.as_object_mut()?.values_mut() {
                    if let Some(found) = find_mut(child, id) {
                        return Some(found);
                    }
                }
            }
        } else if key == "next" {
            if let Some(found) = find_mut(value.get_mut("block")?, id) {
                return Some(found);
            }
        }
    }
    None
}
fn permissions(project: &Value) -> Result<BTreeSet<String>, String> {
    fn visit(b: &Value, p: &Value, out: &mut BTreeSet<String>) -> Result<(), String> {
        if b["disabled"] != true {
            let kind = text(&b["type"])?;
            if kind == "core.knowledge.retrieve" || kind == "core.model.compose" {
                let resource = &p["resources"][text(&b["fields"]["RESOURCE"])?];
                let expected = if kind == "core.knowledge.retrieve" {
                    "knowledge"
                } else {
                    "model"
                };
                if resource["kind"] != expected || resource["scope"] != "project" {
                    return Err(INVALID.into());
                }
                if kind == "core.knowledge.retrieve" {
                    out.insert("knowledge.read".into());
                }
                for cap in array(&resource["capabilityRequirements"])? {
                    out.insert(text(cap)?.into());
                }
            }
            if let Some(inputs) = b.get("inputs") {
                for input in inputs.as_object().ok_or(INVALID)?.values() {
                    if let Some(child) = input.get("block").or_else(|| input.get("shadow")) {
                        visit(child, p, out)?;
                    }
                }
            }
        }
        if let Some(next) = b.get("next") {
            visit(&next["block"], p, out)?;
        }
        Ok(())
    }
    let mut result = BTreeSet::new();
    for workspace in project["workspaces"].as_object().ok_or(INVALID)?.values() {
        for block in array(&workspace["blocks"]["blocks"])? {
            visit(block, project, &mut result)?;
        }
    }
    Ok(result)
}
pub fn validate(original_json: &str, patch: &Value, approved: &[String]) -> Result<Value, String> {
    if original_json.len() > 8 * 1024 * 1024
        || patch.to_string().len() > 2 * 1024 * 1024
        || approved.len() > 100
    {
        return Err(INVALID.into());
    }
    let original = strict_json::parse(original_json.as_bytes())?;
    project_files(&original)?;
    keys(
        patch,
        &[
            "schemaVersion",
            "patchId",
            "projectId",
            "baseDigest",
            "catalogVersion",
            "operations",
            "permissionDelta",
            "diagnostics",
        ],
    )?;
    fn safe(v: &Value, depth: usize) -> Result<(), String> {
        if depth > 100 {
            return Err(INVALID.into());
        }
        match v {
            Value::String(s) => {
                let re = regex::Regex::new(
                    r"(?i)\bBearer\s+\S+|(?:password|token|api[_-]?key)\s*[=:]\s*\S+",
                )
                .map_err(|_| INVALID)?;
                if re.is_match(s) {
                    return Err(INVALID.into());
                }
            }
            Value::Array(a) => {
                for item in a {
                    safe(item, depth + 1)?;
                }
            }
            Value::Object(m) => {
                for (k, item) in m {
                    if [
                        "apikey",
                        "token",
                        "password",
                        "authorization",
                        "cookie",
                        "secret",
                    ]
                    .contains(&k.to_lowercase().replace(['_', '-'], "").as_str())
                    {
                        return Err(INVALID.into());
                    }
                    safe(item, depth + 1)?;
                }
            }
            _ => {}
        }
        Ok(())
    }
    safe(patch, 0)?;
    if !crate::project_store::stable(text(&patch["patchId"])?)
        || array(&patch["diagnostics"])?.len() > 100
    {
        return Err(INVALID.into());
    }
    if patch["schemaVersion"] != "blocky.patch/v1alpha1" || patch["catalogVersion"] != "0.1.0" {
        return Err(INVALID.into());
    }
    if patch["projectId"] != original["manifest"]["projectId"]
        || patch["baseDigest"] != format!("{:x}", Sha256::digest(original_json.as_bytes()))
    {
        return Err("BLK-PATCH-001".into());
    }
    let operations = array(&patch["operations"])?;
    if operations.is_empty() || operations.len() > 500 {
        return Err(INVALID.into());
    }
    let mut next = original.clone();
    for op in operations {
        keys(op, &["op", "moduleId", "blockId", "payload"])?;
        let module = text(&op["moduleId"])?;
        let id = text(&op["blockId"])?;
        let roots = next["workspaces"][module]["blocks"]["blocks"]
            .as_array_mut()
            .ok_or(INVALID)?;
        let pos = roots.iter().position(|b| b["id"] == id);
        match text(&op["op"])? {
            "block.add" => {
                if op["payload"]["id"] != id {
                    return Err(INVALID.into());
                }
                block_shape(&op["payload"], &mut BTreeSet::new(), true, 0)?;
                roots.push(op["payload"].clone());
            }
            "block.remove" => {
                if op.get("payload").is_some() {
                    return Err(INVALID.into());
                }
                roots.remove(pos.ok_or(INVALID)?);
            }
            "block.move" => {
                keys(&op["payload"], &["x", "y"])?;
                let b = &mut roots[pos.ok_or(INVALID)?];
                b["x"] = op["payload"]["x"].clone();
                b["y"] = op["payload"]["y"].clone();
            }
            "block.update" => {
                keys(&op["payload"], &["fields"])?;
                let block = roots
                    .iter_mut()
                    .find_map(|b| find_mut(b, id))
                    .ok_or(INVALID)?;
                for (key, value) in op["payload"]["fields"].as_object().ok_or(INVALID)? {
                    block["fields"][key] = value.clone();
                }
            }
            _ => return Err(INVALID.into()),
        }
    }
    for workspace in next["workspaces"].as_object().ok_or(INVALID)?.values() {
        let mut ids = BTreeSet::new();
        for b in array(&workspace["blocks"]["blocks"])? {
            block_shape(b, &mut ids, false, 0)?;
        }
    }
    project_files(&next)?;
    let before = permissions(&original)?;
    let after = permissions(&next)?;
    let delta: BTreeSet<String> = after.difference(&before).cloned().collect();
    let declared: BTreeSet<String> = array(&patch["permissionDelta"])?
        .iter()
        .map(|v| text(v).map(String::from))
        .collect::<Result<_, _>>()?;
    if delta != declared || !delta.iter().all(|cap| approved.contains(cap)) {
        return Err("BLK-PATCH-003".into());
    }
    Ok(next)
}
