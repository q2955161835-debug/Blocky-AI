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
        &[
            "manifest",
            "workspaces",
            "resources",
            "schemas",
            "surfaces",
            "settings",
        ],
    )?;
    let mut files = ProjectFiles::new();
    files.insert("project.json".into(), project["manifest"].to_string());
    if let Some(settings) = project.get("settings") {
        if project["manifest"]["settingsRef"] != "settings.json" {
            return Err(INVALID.into());
        }
        files.insert("settings.json".into(), settings.to_string());
    }
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
            files.insert(
                path.clone(),
                if field == "surfaces" && !path.ends_with(".json") {
                    value.as_str().ok_or(INVALID)?.into()
                } else {
                    value.to_string()
                },
            );
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
    let text_catalog: Value = serde_json::from_str(include_str!(
        "../../../packages/block-catalog/src/text-primitives.json"
    ))
    .map_err(|_| INVALID)?;
    let agent_catalog: Value = serde_json::from_str(include_str!("../../../packages/block-catalog/src/agent-primitives.json")).map_err(|_| INVALID)?;
    let event_catalog: Value = serde_json::from_str(include_str!("../../../packages/block-catalog/src/event-primitives.json")).map_err(|_| INVALID)?;
    let flow_catalog: Value = serde_json::from_str(include_str!("../../../packages/block-catalog/src/flow-primitives.json")).map_err(|_| INVALID)?;
    let rpa_catalog: Value = serde_json::from_str(include_str!("../../../packages/block-catalog/src/rpa-primitives.json")).map_err(|_| INVALID)?;
    array(&catalog)?
        .iter()
        .chain(array(&text_catalog)?.iter()).chain(array(&agent_catalog)?.iter())
        .chain(array(&event_catalog)?.iter()).chain(array(&flow_catalog)?.iter()).chain(array(&rpa_catalog)?.iter())
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
                "extraState",
            ],
        )?;
    }
    if let Some(extra) = block.get("extraState") {
        blueprint_state(block, extra)?;
    }
    let id = text(&block["id"])?;
    if !crate::project_store::stable(id) || !ids.insert(id.into()) {
        return Err(INVALID.into());
    }
    let def = definition(text(&block["type"])?)?;
    if let Some(fields) = block.get("fields") {
        for (key, value) in fields.as_object().ok_or(INVALID)? {
            let is_json = def["jsonFields"]
                .as_array()
                .is_some_and(|a| a.iter().any(|f| f == key));
            if !array(&def["fields"])?.iter().any(|f| f == key)
                || (!is_json
                    && value
                        .as_str()
                        .is_none_or(|s| s.is_empty() || s.len() > 64000))
                || (is_json && value.to_string().len() > 64000)
            {
                return Err(INVALID.into());
            }
        }
    }
    for field in array(&def["fields"])? {
        let field_name = text(field)?;
        if block["fields"].get(field_name).is_none()
            && def["optionalFields"]
                .as_array()
                .is_some_and(|a| a.iter().any(|f| f == field))
        {
            continue;
        }
        if def["jsonFields"]
            .as_array()
            .is_some_and(|a| a.iter().any(|f| f == field))
        {
            if block["fields"].get(field_name).is_none() {
                return Err(INVALID.into());
            }
        } else {
            text(&block["fields"][field_name])?;
        }
        if let Some(options) = def["fieldOptions"].get(text(field)?) {
            if !array(options)?.contains(&block["fields"][text(field)?]) {
                return Err(INVALID.into());
            }
        }
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
fn blueprint_state(block: &Value, extra: &Value) -> Result<(), String> {
    keys(extra, &["blueprintInstance"])?;
    let state = &extra["blueprintInstance"];
    keys(
        state,
        &[
            "schemaVersion",
            "instanceId",
            "blueprintId",
            "version",
            "digest",
            "sourceRootId",
            "idMap",
            "bindings",
            "base",
        ],
    )?;
    if state["schemaVersion"] != "blocky.blueprint-instance/v1"
        || state["version"]
            .as_u64()
            .is_none_or(|v| v == 0 || v > 100000)
        || state["base"]["id"] != block["id"]
    {
        return Err(INVALID.into());
    }
    for field in ["instanceId", "blueprintId", "sourceRootId"] {
        if !project_store::stable(text(&state[field])?) {
            return Err(INVALID.into());
        }
    }
    let hash = text(&state["digest"])?;
    if hash.len() != 64
        || !hash
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
    {
        return Err(INVALID.into());
    }
    let mapping = state["idMap"].as_object().ok_or(INVALID)?;
    if mapping.get(text(&state["sourceRootId"])?) != Some(&block["id"]) {
        return Err(INVALID.into());
    }
    keys(&state["bindings"], &["resources", "modules"])?;
    for map in [
        mapping,
        state["bindings"]["resources"].as_object().ok_or(INVALID)?,
        state["bindings"]["modules"].as_object().ok_or(INVALID)?,
    ] {
        for (key, value) in map {
            if !project_store::stable(key) || !project_store::stable(text(value)?) {
                return Err(INVALID.into());
            }
        }
    }
    fn no_nested_state(value: &Value, depth: usize) -> Result<(), String> {
        if depth > 80 {
            return Err(INVALID.into());
        }
        match value {
            Value::Object(map) => {
                for (key, child) in map {
                    if key == "extraState" {
                        return Err(INVALID.into());
                    }
                    no_nested_state(child, depth + 1)?;
                }
            }
            Value::Array(values) => {
                for child in values {
                    no_nested_state(child, depth + 1)?;
                }
            }
            _ => (),
        }
        Ok(())
    }
    no_nested_state(&state["base"], 0)?;
    block_shape(&state["base"], &mut BTreeSet::new(), true, 0)
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
fn permissions(project: &Value, registry: &Value, allow_unresolved: bool) -> Result<BTreeSet<String>, String> {
    fn visit(
        b: &Value,
        p: &Value,
        registry: &Value,
        allow_unresolved: bool,
        out: &mut BTreeSet<String>,
    ) -> Result<(), String> {
        if b["disabled"] != true {
            let kind = text(&b["type"])?;
            out.extend(crate::rpa::language::permissions(kind, &b["fields"]));
            if ["core.knowledge.retrieve", "core.model.compose", "core.tool.invoke"].contains(&kind) {
                let resource_id = text(&b["fields"]["RESOURCE"])?;
                let expected = if kind == "core.knowledge.retrieve" {
                    "knowledge"
                } else if kind == "core.tool.invoke" {
                    "tool"
                } else {
                    "model"
                };
                let reference = array(&p["manifest"]["resources"])?
                    .iter()
                    .find(|r| r["resourceId"] == resource_id && r["kind"] == expected);
                // An unresolved old reference grants no capabilities. The repaired
                // project is checked strictly, and new capabilities still need approval.
                if let Some(reference) = reference {
                let resource = if reference["scope"] == "project" {
                    &p["resources"][resource_id]
                } else if reference["scope"] == "user"
                    && registry["schemaVersion"] == "blocky.resource-registry/v1"
                {
                    array(&registry["resources"])?
                        .iter()
                        .find(|r| r["resourceId"] == reference["definitionRef"])
                        .ok_or(INVALID)?
                } else {
                    return Err(INVALID.into());
                };
                if resource["resourceId"] != resource_id
                    || resource["kind"] != expected
                    || resource["scope"] != reference["scope"]
                {
                    return Err(INVALID.into());
                }
                for binding in array(&resource["secretBindings"])? {
                    if !array(&reference["secretRefs"])?.contains(&binding["secretRef"]) {
                        return Err(INVALID.into());
                    }
                }
                if kind == "core.knowledge.retrieve" {
                    out.insert("knowledge.read".into());
                }
                if kind == "core.tool.invoke" {
                    for cap in array(&resource["definition"]["permissions"])? {out.insert(text(cap)?.into());}
                }
                for cap in array(&resource["capabilityRequirements"])? {
                    out.insert(text(cap)?.into());
                }
                } else if !allow_unresolved {
                    return Err(INVALID.into());
                }
            }
            if let Some(inputs) = b.get("inputs") {
                for input in inputs.as_object().ok_or(INVALID)?.values() {
                    if let Some(child) = input.get("block").or_else(|| input.get("shadow")) {
                        visit(child, p, registry, allow_unresolved, out)?;
                    }
                }
            }
        }
        if let Some(next) = b.get("next") {
            visit(&next["block"], p, registry, allow_unresolved, out)?;
        }
        Ok(())
    }
    let mut result = BTreeSet::new();
    for surface in array(&project["manifest"]["appSurfaces"])? {
        let manifest = &project["surfaces"][text(&surface["manifestRef"])?];
        for cap in array(&manifest["permissions"])? {
            result.insert(text(cap)?.into());
        }
    }
    for workspace in project["workspaces"].as_object().ok_or(INVALID)?.values() {
        for block in array(&workspace["blocks"]["blocks"])? {
            visit(block, project, registry, allow_unresolved, &mut result)?;
        }
    }
    Ok(result)
}
pub fn validate(original_json: &str, patch: &Value, approved: &[String]) -> Result<Value, String> {
    validate_with_registry(original_json, patch, approved, &Value::Null)
}
pub fn validate_with_registry(
    original_json: &str,
    patch: &Value,
    approved: &[String],
    registry: &Value,
) -> Result<Value, String> {
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
    if patch["schemaVersion"] != "blocky.patch/v1alpha1" || patch["catalogVersion"] != env!("CARGO_PKG_VERSION") {
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
        if op["op"] == "app-surface.add" {
            crate::surface_guard::append(&mut next, op, approved)?;
            continue;
        }
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
                let def = definition(text(&block["type"])?)?;
                for (key, value) in op["payload"]["fields"].as_object().ok_or(INVALID)? {
                    block["fields"][key] = if def["jsonFields"]
                        .as_array()
                        .is_some_and(|a| a.iter().any(|f| f == key))
                    {
                        strict_json::parse(text(value)?.as_bytes())?
                    } else {
                        value.clone()
                    };
                }
            }
            _ => return Err(INVALID.into()),
        }
    }
    for workspace in next["workspaces"].as_object().ok_or(INVALID)?.values() {
        let mut ids = BTreeSet::new();
        for b in array(&workspace["blocks"]["blocks"])? {
            block_shape(b, &mut ids, false, 0)?;
            crate::rpa::language::validate(b, false)?;
        }
    }
    fn stage4(v: &Value) -> bool {
        match v {
            Value::Object(m) => m.get("type").and_then(Value::as_str).is_some_and(|t| ["core.prompt.context","core.run.budget","core.data.set","core.logic.condition","core.memory.read","core.memory.write","core.memory.delete","core.tool.invoke","core.guardrail.evidence","core.output.structured","core.output.file"].contains(&t)) || m.values().any(stage4),
            Value::Array(a) => a.iter().any(stage4), _ => false,
        }
    }
    if stage4(&next["workspaces"]) && ["0.1.0","0.2.0","0.3.0"].contains(&next["manifest"]["format"]["minimumReaderVersion"].as_str().unwrap_or("")) {
        next["manifest"]["format"]["minimumReaderVersion"] = Value::String("0.4.0".into());
    }
    project_files(&next)?;
    crate::patch_links::validate(&next)?;
    let before = permissions(&original, registry, true)?;
    let after = permissions(&next, registry, false)?;
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
