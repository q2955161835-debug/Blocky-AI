use super::*;
use serde_json::Value;
/// Cached ACL fields are never authoritative. Every indexed source reference must
/// still name a readable grant in this collection and carry the current epoch.
pub fn validate(value: &Value, state: &Collection) -> Result<(), String> {
    if value.is_null() {
        return Ok(());
    }
    if value["schemaVersion"] != "blocky.knowledge-store/v1" {
        return Err(INVALID.into());
    }
    for index in [&value["index"], &value["pending"]["index"]] {
        if index.is_null() {
            continue;
        }
        if index["generation"].as_u64() != Some(state.generation) {
            return Err(STALE.into());
        }
        let sources = index["sources"].as_object().ok_or(INVALID)?;
        let permitted = |id: &str| {
            state
                .sources
                .iter()
                .any(|s| s.source_id == id && s.readable())
        };
        if sources.keys().any(|id| !permitted(id)) {
            return Err(DENIED.into());
        }
        for key in ["documents", "chunks"] {
            for entry in index[key].as_array().ok_or(INVALID)? {
                let id = entry["sourceId"].as_str().ok_or(INVALID)?;
                if !sources.contains_key(id) || !permitted(id) {
                    return Err(DENIED.into());
                }
            }
        }
    }
    if let Some(refs) = value["pending"].get("chunkRefs") {
        let refs = refs.as_array().ok_or(INVALID)?;
        if refs.len() > 250000 {
            return Err(LIMIT.into());
        }
        let published: std::collections::HashMap<&str, &Value> = value["index"]["chunks"]
            .as_array()
            .ok_or(INVALID)?
            .iter()
            .map(|chunk| Ok((chunk["chunkId"].as_str().ok_or(INVALID)?, chunk)))
            .collect::<Result<_, &str>>()?;
        let sources = value["pending"]["index"]["sources"]
            .as_object()
            .ok_or(INVALID)?;
        let mut seen = std::collections::HashSet::new();
        for reference in refs {
            let id = reference.as_str().ok_or(INVALID)?;
            let chunk = published.get(id).ok_or(INVALID)?;
            if !seen.insert(id) || !sources.contains_key(chunk["sourceId"].as_str().ok_or(INVALID)?)
            {
                return Err(INVALID.into());
            }
        }
    }
    for (pending, index) in [(false, &value["index"]), (true, &value["pending"]["index"])] {
        if index.is_null() {
            continue;
        }
        let mut chunks: std::collections::HashMap<&str, &Value> = index["chunks"]
            .as_array()
            .ok_or(INVALID)?
            .iter()
            .map(|chunk| Ok((chunk["chunkId"].as_str().ok_or(INVALID)?, chunk)))
            .collect::<Result<_, &str>>()?;
        if pending {
            if let Some(refs) = value["pending"]["chunkRefs"].as_array() {
                let referenced: std::collections::HashSet<&str> =
                    refs.iter().filter_map(Value::as_str).collect();
                for chunk in value["index"]["chunks"].as_array().ok_or(INVALID)? {
                    if let Some(id) = chunk["chunkId"]
                        .as_str()
                        .filter(|id| referenced.contains(id))
                    {
                        if chunks.insert(id, chunk).is_some() {
                            return Err(INVALID.into());
                        }
                    }
                }
            }
        }
        for document in index["documents"].as_array().ok_or(INVALID)? {
            for id in document["chunkIds"].as_array().ok_or(INVALID)? {
                let chunk = chunks.get(id.as_str().ok_or(INVALID)?).ok_or(INVALID)?;
                if chunk["sourceId"] != document["sourceId"]
                    || chunk["documentId"] != document["documentId"]
                    || chunk["revision"] != document["revision"]
                {
                    return Err(INVALID.into());
                }
            }
        }
    }
    Ok(())
}
