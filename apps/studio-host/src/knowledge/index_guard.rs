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
    Ok(())
}
