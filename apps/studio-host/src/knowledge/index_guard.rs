use super::*;
use serde_json::Value;
/// Compact an already validated legacy checkpoint for transport. Compare every
/// field, not just content hashes: citations and source identity remain distinct.
pub fn compact_checkpoint(value: &mut Value) {
    let Some(store) = value.as_object_mut() else {
        return;
    };
    let Some(mut pending) = store.remove("pending") else {
        return;
    };
    if let (Some(published), Some(staged)) = (
        store.get("index").and_then(|v| v["chunks"].as_array()),
        pending
            .get_mut("index")
            .and_then(|v| v["chunks"].as_array_mut()),
    ) {
        let by_id: std::collections::HashMap<&str, &Value> = published
            .iter()
            .filter_map(|chunk| Some((chunk["chunkId"].as_str()?, chunk)))
            .collect();
        let mut references = Vec::new();
        staged.retain(|chunk| {
            let Some(id) = chunk["chunkId"].as_str() else {
                return true;
            };
            if by_id.get(id).is_some_and(|prior| *prior == chunk) {
                references.push(Value::String(id.to_owned()));
                false
            } else {
                true
            }
        });
        if !references.is_empty() {
            let object = pending.as_object_mut().expect("validated pending object");
            let refs = object
                .entry("chunkRefs")
                .or_insert_with(|| Value::Array(Vec::new()));
            refs.as_array_mut()
                .expect("validated references")
                .extend(references);
        }
    }
    store.insert("pending".into(), pending);
}
#[cfg(test)]
mod compact_tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn legacy_checkpoint_shares_only_identical_chunks_and_preserves_existing_refs() {
        let original = json!({"index":{"chunks":[{"chunkId":"a","sourceId":"s1","text":"same"},{"chunkId":"b","sourceId":"s1","text":"same"}]},"pending":{"index":{"chunks":[{"chunkId":"a","sourceId":"s1","text":"same"},{"chunkId":"b","sourceId":"s2","text":"same"}]},"chunkRefs":[]}});
        let mut compact = original.clone();
        compact_checkpoint(&mut compact);
        assert_eq!(compact["pending"]["chunkRefs"], json!(["a"]));
        assert_eq!(
            compact["pending"]["index"]["chunks"],
            json!([{"chunkId":"b","sourceId":"s2","text":"same"}])
        );
        let once = compact.clone();
        compact_checkpoint(&mut compact);
        assert_eq!(compact, once);
        assert_eq!(compact["index"], original["index"]);
    }
}
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
