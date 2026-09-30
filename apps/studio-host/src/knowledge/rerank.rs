use super::*;
use serde_json::{json, Value};
pub fn query(
    store: &KnowledgeStore,
    project: &str,
    collection: &str,
    model: &str,
    revision: u64,
    generation: u64,
    query: &str,
    ids: &[String],
) -> Result<Value, String> {
    if model != small_models::RERANK
        || ids.len() > 200
        || query.trim().is_empty()
        || query.len() > 16384
    {
        return Err(INVALID.into());
    }
    let path = store.scope(project, collection)?;
    let _cancel = cancel::Cancellation::begin(&path);
    let read = || {
        store.locked(project, collection, |path, state| {
            if state.revision != revision || state.generation != generation {
                return Err(STALE.into());
            }
            let id = state.index.as_deref().ok_or("BLK-EMBED-NOT-READY")?;
            if !valid_id(id) {
                return Err(INVALID.into());
            }
            let value: Value =
                store::read_json(&path.join(format!("index-{id}.json")), 1024 * 1024 * 1024)?;
            index_guard::validate(&value, state)?;
            let chunks = value["index"]["chunks"].as_array().ok_or(INVALID)?;
            let mut seen = std::collections::HashSet::new();
            ids.iter()
                .map(|id| {
                    if !valid_id(id) || !seen.insert(id) {
                        return Err(INVALID.into());
                    }
                    let chunk = chunks
                        .iter()
                        .find(|c| c["chunkId"].as_str() == Some(id))
                        .ok_or(DENIED)?;
                    let text = chunk["text"].as_str().ok_or(INVALID)?;
                    if chunk["digest"] != digest(text.as_bytes()) {
                        return Err("BLK-KNOW-CORRUPT".into());
                    }
                    Ok(text.to_owned())
                })
                .collect::<Result<Vec<_>, String>>()
        })
    };
    let texts = read()?;
    let started = std::time::Instant::now();
    let scores =
        small_models::rerank(query, &texts.iter().map(String::as_str).collect::<Vec<_>>())?;
    cancel::check()?;
    // Re-authorize before returning any scores if a source changed during inference.
    if read()? != texts {
        return Err(STALE.into());
    }
    let mut hits = ids
        .iter()
        .zip(scores)
        .map(|(id, score)| json!({"chunkId":id,"score":score}))
        .collect::<Vec<_>>();
    hits.sort_by(|a, b| {
        b["score"]
            .as_f64()
            .unwrap_or(0.)
            .total_cmp(&a["score"].as_f64().unwrap_or(0.))
    });
    let mut result = small_models::metadata(model)?;
    result["indexRevision"] = revision.into();
    result["generation"] = generation.into();
    result["hits"] = hits.into();
    result["elapsedMs"] = (started.elapsed().as_millis() as u64).into();
    Ok(result)
}
