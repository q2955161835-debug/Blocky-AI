use super::*;
use serde_json::{Value, json};
pub fn dispatch(store: &KnowledgeStore, request: &Value) -> Result<Value, String> {
    let object = request.as_object().ok_or(INVALID)?;
    let operation = request["operation"].as_str().ok_or(INVALID)?;
    let extra: &[&str] = match operation {
        "knowledge-source-add" => &["kind", "path", "url", "ref"],
        "knowledge-sources" | "knowledge-load-index" | "knowledge-cancel" => &[],
        "knowledge-read-source" => &["sourceId", "cursor", "snapshotRevision"],
        "knowledge-source-remove" => &["sourceId"],
        "knowledge-source-acl" => &["sourceId", "allowedPrincipals"],
        "knowledge-save-index" => &["expectedRevision", "expectedGeneration", "value"],
        _ => return Err(INVALID.into()),
    };
    if object.keys().any(|k| {
        !["schemaVersion", "operation", "projectId", "collectionId"].contains(&k.as_str())
            && !extra.contains(&k.as_str())
    }) {
        return Err(INVALID.into());
    }
    let string = |key: &str| request[key].as_str().ok_or_else(|| INVALID.to_string());
    let p = string("projectId")?;
    let c = string("collectionId")?;
    match operation {
        "knowledge-source-add" => {
            let kind = string("kind")?;
            if kind == "url" && object.contains_key("path")
                || kind != "url" && object.contains_key("url")
            {
                return Err(INVALID.into());
            }
            store.add(
                p,
                c,
                kind,
                string(if kind == "url" { "url" } else { "path" })?,
                request.get("ref").map(|_| string("ref")).transpose()?,
            )
        }
        "knowledge-sources" => store.sources(p, c),
        "knowledge-read-source" => {
            let cursor = request
                .get("cursor")
                .map(|v| {
                    v.as_u64()
                        .and_then(|n| usize::try_from(n).ok())
                        .ok_or(INVALID)
                })
                .transpose()?;
            store.read_source(
                p,
                c,
                string("sourceId")?,
                cursor,
                request
                    .get("snapshotRevision")
                    .map(|_| string("snapshotRevision"))
                    .transpose()?,
            )
        }
        "knowledge-source-remove" => store.remove(p, c, string("sourceId")?),
        "knowledge-source-acl" => {
            let principals =
                serde_json::from_value::<Vec<String>>(request["allowedPrincipals"].clone())
                    .map_err(|_| INVALID)?;
            store.acl(p, c, string("sourceId")?, principals)
        }
        "knowledge-load-index" => store.load_index(p, c),
        "knowledge-save-index" => store.save_index(
            p,
            c,
            request["expectedRevision"].as_u64().ok_or(INVALID)?,
            request["expectedGeneration"].as_u64().ok_or(INVALID)?,
            request.get("value").cloned().ok_or(INVALID)?,
        ),
        "knowledge-cancel" => {
            store.cancel(p, c)?;
            Ok(json!({"cancelled":true}))
        }
        _ => Err(INVALID.into()),
    }
}
