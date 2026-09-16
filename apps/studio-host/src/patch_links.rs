use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};
const INVALID: &str = "BLK-PATCH-004";
fn active<'a>(block: &'a Value, owner: bool, out: &mut Vec<(&'a Value, bool)>) {
    let owner = owner || block["type"] == "core.agent" || block["type"] == "core.agent.define";
    if block["disabled"] != true {
        out.push((block, owner));
        if let Some(inputs) = block["inputs"].as_object() {
            for input in inputs.values() {
                if let Some(child) = input.get("block").or_else(|| input.get("shadow")) {
                    active(child, owner, out);
                }
            }
        }
    }
    if let Some(next) = block["next"].get("block") {
        active(next, owner, out);
    }
}
fn root<'a>(block: &'a Value) -> Option<&'a Value> {
    if block["disabled"] == true {
        block["next"].get("block").and_then(root)
    } else {
        Some(block)
    }
}
pub fn validate(project: &Value) -> Result<(), String> {
    let modules = project["manifest"]["modules"].as_array().ok_or(INVALID)?;
    let mut graph: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for module in modules {
        let id = module["moduleId"].as_str().ok_or(INVALID)?;
        let roots = project["workspaces"][id]["blocks"]["blocks"]
            .as_array()
            .ok_or(INVALID)?;
        let mut blocks = Vec::new();
        for block in roots {
            active(block, false, &mut blocks);
        }
        for (block, owner) in blocks {
            let fields = &block["fields"];
            for key in ["MODULE", "EXPORT", "RESOURCE"] {
                if let Some(value) = fields.get(key) {
                    if !value.as_str().is_some_and(crate::project_store::stable) {
                        return Err(INVALID.into());
                    }
                }
            }
            for key in ["INPUT", "OUTPUT"] {
                if let Some(value) = fields.get(key) {
                    if !value.as_str().is_some_and(crate::project_store::reference) {
                        return Err(INVALID.into());
                    }
                }
            }
            if (block["type"] == "core.interaction.chat"
                || block["type"] == "core.interaction.chat_entry")
                && !owner
            {
                return Err(INVALID.into());
            }
            if block["type"] != "core.module.call" {
                continue;
            }
            let target_id = fields["MODULE"].as_str().ok_or(INVALID)?;
            let target = modules
                .iter()
                .find(|m| m["moduleId"] == target_id)
                .ok_or(INVALID)?;
            let export = target["exports"]
                .as_array()
                .ok_or(INVALID)?
                .iter()
                .find(|e| e["exportId"] == fields["EXPORT"])
                .ok_or(INVALID)?;
            let target_roots: Vec<&Value> = project["workspaces"][target_id]["blocks"]["blocks"]
                .as_array()
                .ok_or(INVALID)?
                .iter()
                .filter_map(root)
                .collect();
            if export["kind"] == "tool"
                && !target_roots.iter().any(|b| {
                    b["type"] == "core.tool.entry" && b["fields"]["EXPORT"] == fields["EXPORT"]
                })
            {
                return Err(INVALID.into());
            }
            if export["kind"] == "agent"
                && target_roots
                    .iter()
                    .filter(|b| b["type"] == "core.agent" || b["type"] == "core.agent.define")
                    .count()
                    != 1
            {
                return Err(INVALID.into());
            }
            for (call, expected) in [("INPUT", "inputSchemaRef"), ("OUTPUT", "outputSchemaRef")] {
                let a = fields[call].as_str().ok_or(INVALID)?;
                let b = export[expected].as_str().ok_or(INVALID)?;
                let schemas = project["schemas"].as_object().ok_or(INVALID)?;
                if schemas.get(a).ok_or(INVALID)? != schemas.get(b).ok_or(INVALID)? {
                    return Err(INVALID.into());
                }
            }
            graph.entry(id.into()).or_default().push(target_id.into());
        }
    }
    fn visit(
        id: &str,
        graph: &BTreeMap<String, Vec<String>>,
        done: &mut BTreeSet<String>,
        path: &mut BTreeSet<String>,
    ) -> Result<(), String> {
        if path.contains(id) {
            return Err(INVALID.into());
        }
        if done.contains(id) {
            return Ok(());
        }
        path.insert(id.into());
        if let Some(targets) = graph.get(id) {
            for target in targets {
                visit(target, graph, done, path)?;
            }
        }
        path.remove(id);
        done.insert(id.into());
        Ok(())
    }
    let mut done = BTreeSet::new();
    for id in graph.keys() {
        visit(id, &graph, &mut done, &mut BTreeSet::new())?;
    }
    Ok(())
}
