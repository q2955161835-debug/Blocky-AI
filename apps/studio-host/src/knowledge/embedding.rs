//! Embedding jobs checkpoint binary records before atomically publishing a small
//! source-authorized row map. Querying never exports or deserializes the matrix.
use super::*;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashSet,
    fs::{self, OpenOptions},
    path::{Path, PathBuf},
    sync::{Arc, Mutex, OnceLock},
    time::{Instant, SystemTime},
};
const MAX_ROWS: usize = 200_000;
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Row {
    chunk_id: String,
    source_id: String,
    key: String,
    offset: u64,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Published {
    schema_version: String,
    model_id: String,
    model_signature: String,
    index_revision: u64,
    generation: u64,
    dimension: usize,
    rows: Vec<Row>,
}
struct PublishedCache {
    path: PathBuf,
    modified: Option<SystemTime>,
    length: u64,
    value: Arc<Published>,
}
static PUBLISHED: OnceLock<Mutex<Option<PublishedCache>>> = OnceLock::new();
fn versions(state: &Collection, revision: u64, generation: u64) -> Result<(), String> {
    if state.revision != revision || state.generation != generation {
        Err(STALE.into())
    } else {
        Ok(())
    }
}
fn epoch(
    store: &KnowledgeStore,
    p: &str,
    c: &str,
    revision: u64,
    generation: u64,
) -> Result<(), String> {
    store.locked(p, c, |_, state| versions(state, revision, generation))
}
fn pack(path: &Path, model: &str) -> Result<PathBuf, String> {
    Ok(path.join(format!(
        "vectors-{}.bin",
        embedding_backend::signature(model)?
    )))
}
fn evidence(model: &str, revision: u64, generation: u64) -> Result<Value, String> {
    let mut value = embedding_backend::metadata(model)?;
    value["indexRevision"] = revision.into();
    value["generation"] = generation.into();
    Ok(value)
}

fn snapshot(
    store: &KnowledgeStore,
    p: &str,
    c: &str,
    revision: u64,
    generation: u64,
) -> Result<Value, String> {
    store.locked(p, c, |path, state| {
        versions(state, revision, generation)?;
        let id = state.index.as_deref().ok_or("BLK-EMBED-NOT-READY")?;
        if !valid_id(id) {
            return Err(INVALID.into());
        }
        let mut value: Value =
            store::read_json(&path.join(format!("index-{id}.json")), 1024 * 1024 * 1024)?;
        index_guard::validate(&value, state)?;
        if value["index"].is_null() {
            return Err("BLK-EMBED-NOT-READY".into());
        }
        Ok(value["index"].take())
    })
}
pub fn build_index(
    store: &KnowledgeStore,
    p: &str,
    c: &str,
    model: &str,
    revision: u64,
    generation: u64,
) -> Result<Value, String> {
    embedding_backend::validate_id(model)?;
    let path = store.scope(p, c)?;
    let _cancel = cancel::Cancellation::begin(&path);
    let lock_path = path.join("embedding.lock");
    if lock_path.exists() {
        ingest::no_links(&lock_path)?;
    }
    let lock = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(lock_path)
        .map_err(|_| IO)?;
    lock.try_lock().map_err(|_| "BLK-EMBED-BUSY")?;
    let start = Instant::now();
    let index = snapshot(store, p, c, revision, generation)?;
    let chunks = index["chunks"].as_array().ok_or(INVALID)?;
    if chunks.len() > MAX_ROWS {
        return Err(LIMIT.into());
    }
    let mut total = 0usize;
    let mut ids = HashSet::new();
    for chunk in chunks {
        let id = chunk["chunkId"].as_str().ok_or(INVALID)?;
        let text = chunk["text"].as_str().ok_or(INVALID)?;
        if !valid_id(id) || !ids.insert(id) || text.len() > 65536 || text.trim().is_empty() {
            return Err(INVALID.into());
        }
        total += text.len();
        if total > MAX_CORPUS * 2 {
            return Err(LIMIT.into());
        }
    }
    embedding_backend::install(model)?;
    let mut cache = embedding_binary::Cache::open(&pack(&path, model)?)?;
    let mut rows = Vec::with_capacity(chunks.len());
    let mut embedded = 0usize;
    let mut reused = 0usize;
    let signature = embedding_backend::signature(model)?;
    let progress = |completed: usize, embedded: usize, reused: usize| -> Result<(), String> {
        store::atomic_json(
            &path.join("embedding-progress.json"),
            &json!({"modelId":model,"indexRevision":revision,"generation":generation,"completed":completed,"total":chunks.len(),"embedded":embedded,"reused":reused,"published":false}),
        )
    };
    progress(0, 0, 0)?;
    for chunk in chunks {
        // Cached rows contain no inference or side effect; check a bounded batch.
        if rows.len() % 16 == 0 {
            cancel::check()?;
            epoch(store, p, c, revision, generation)?;
        }
        let text = chunk["text"].as_str().ok_or(INVALID)?;
        let key = digest(format!("{signature}\0passage\0{text}").as_bytes());
        let offset = if let Some(offset) = cache.entries.get(&key) {
            reused += 1;
            *offset
        } else {
            // Recheck before every actual inference, including mid-batch revocation.
            cancel::check()?;
            epoch(store, p, c, revision, generation)?;
            let vector = embedding_backend::infer(model, text, false)?;
            cancel::check()?;
            let offset = cache.append(&key, &vector)?;
            embedded += 1;
            offset
        };
        rows.push(Row {
            chunk_id: chunk["chunkId"].as_str().ok_or(INVALID)?.into(),
            source_id: chunk["sourceId"].as_str().ok_or(INVALID)?.into(),
            key,
            offset,
        });
        if rows.len() % 16 == 0 {
            cache.checkpoint()?;
            progress(rows.len(), embedded, reused)?;
        }
    }
    cache.checkpoint()?;
    cancel::check()?;
    let published = Published {
        schema_version: "blocky.embedding-index/v1".into(),
        model_id: model.into(),
        model_signature: signature,
        index_revision: revision,
        generation,
        dimension: embedding_model::DIM,
        rows,
    };
    store.locked(p, c, |path, state| {
        cancel::check()?;
        versions(state, revision, generation)?;
        // Keep the previous valid model publication, including legacy active-only indexes.
        migration::archive_current(path)?;
        // Keep prior compatible publications for an explicit model rollback.
        store::atomic_json(
            &path.join(format!("embedding-{}.json", published.model_signature)),
            &published,
        )?;
        store::atomic_json(&path.join("embedding.json"), &published)
    })?;
    let mut result = evidence(model, revision, generation)?;
    result["chunkCount"] = chunks.len().into();
    result["embedded"] = embedded.into();
    result["reused"] = reused.into();
    result["elapsedMs"] = (start.elapsed().as_millis() as u64).into();
    result["published"] = true.into();
    store::atomic_json(&path.join("embedding-progress.json"), &result)?;
    Ok(result)
}
fn validate_shape(value: &Published) -> Result<(), String> {
    if value.schema_version != "blocky.embedding-index/v1"
        || embedding_backend::validate_id(&value.model_id).is_err()
        || value.model_signature != embedding_backend::signature(&value.model_id)?
        || value.dimension != embedding_model::DIM
        || value.rows.len() > MAX_ROWS
    {
        return Err("BLK-EMBED-CORRUPT".into());
    }
    let mut ids = HashSet::new();
    for row in &value.rows {
        if !valid_id(&row.chunk_id)
            || !valid_id(&row.source_id)
            || !ids.insert(&row.chunk_id)
            || row.key.len() != 64
            || !row.key.bytes().all(|b| b.is_ascii_hexdigit())
        {
            return Err("BLK-EMBED-CORRUPT".into());
        }
    }
    Ok(())
}
fn published(
    path: &Path,
    state: &Collection,
    revision: u64,
    generation: u64,
) -> Result<Arc<Published>, String> {
    versions(state, revision, generation)?;
    let path = path.join("embedding.json");
    if !path.exists() {
        return Err("BLK-EMBED-NOT-READY".into());
    }
    ingest::no_links(&path)?;
    let metadata = fs::metadata(&path).map_err(|_| IO)?;
    let modified = metadata.modified().ok();
    let length = metadata.len();
    let mutex = PUBLISHED.get_or_init(|| Mutex::new(None));
    let mut cache = mutex.lock().map_err(|_| IO)?;
    let value = if let Some(cached) = cache
        .as_ref()
        .filter(|v| v.path == path && v.modified == modified && v.length == length)
    {
        cached.value.clone()
    } else {
        let value: Published = store::read_json(&path, 128 * 1024 * 1024)?;
        validate_shape(&value)?;
        let value = Arc::new(value);
        *cache = Some(PublishedCache {
            path,
            modified,
            length,
            value: value.clone(),
        });
        value
    };
    if value.index_revision != revision || value.generation != generation {
        return Err("BLK-EMBED-NOT-READY".into());
    }
    let allowed = state
        .sources
        .iter()
        .filter(|s| s.readable())
        .map(|s| s.source_id.as_str())
        .collect::<HashSet<_>>();
    if value
        .rows
        .iter()
        .any(|row| !allowed.contains(row.source_id.as_str()))
    {
        return Err(DENIED.into());
    }
    Ok(value)
}
pub fn query(
    store: &KnowledgeStore,
    p: &str,
    c: &str,
    model: &str,
    revision: u64,
    generation: u64,
    text: &str,
    eligible: &[String],
    top: usize,
) -> Result<Value, String> {
    embedding_backend::validate_id(model)?;
    if !(1..=200).contains(&top)
        || eligible.len() > MAX_ROWS
        || text.trim().is_empty()
        || text.len() > 16384
    {
        return Err(INVALID.into());
    }
    let path = store.scope(p, c)?;
    let _cancel = cancel::Cancellation::begin(&path);
    let start = Instant::now();
    let published = store.locked(p, c, |path, state| {
        published(path, state, revision, generation)
    })?;
    if published.model_id != model {
        return Err("BLK-EMBED-MODEL-MISMATCH".into());
    }
    let selected_ids = eligible.iter().map(String::as_str).collect::<HashSet<_>>();
    if selected_ids.len() != eligible.len() {
        return Err(INVALID.into());
    }
    let mut selected = published
        .rows
        .iter()
        .filter(|row| selected_ids.contains(row.chunk_id.as_str()))
        .collect::<Vec<_>>();
    if selected.len() != selected_ids.len() {
        return Err(DENIED.into());
    }
    selected.sort_by_key(|row| row.offset);
    let mut hits = Vec::<(String, f32)>::new();
    if !selected.is_empty() {
        let vector = embedding_backend::infer(model, text, true)?;
        let mut reader = embedding_binary::VectorReader::open(&pack(&path, model)?)?;
        let mut previous: Option<(u64, String, Vec<f32>)> = None;
        for (n, row) in selected.iter().enumerate() {
            if n % 128 == 0 {
                cancel::check()?;
            }
            if previous
                .as_ref()
                .is_none_or(|(offset, key, _)| *offset != row.offset || key != &row.key)
            {
                previous = Some((
                    row.offset,
                    row.key.clone(),
                    reader.read(row.offset, &row.key)?,
                ));
            }
            let embedding = &previous.as_ref().ok_or(INVALID)?.2;
            let score = embedding
                .iter()
                .zip(&vector)
                .map(|(a, b)| a * b)
                .sum::<f32>()
                .clamp(-1., 1.);
            hits.push((row.chunk_id.clone(), score));
        }
        hits.sort_by(|a, b| b.1.total_cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
        hits.truncate(top);
    }
    cancel::check()?;
    store.locked(p, c, |_, state| {
        versions(state, revision, generation)?;
        let permitted: HashSet<_> = state
            .sources
            .iter()
            .filter(|s| s.readable())
            .map(|s| s.source_id.as_str())
            .collect();
        if selected
            .iter()
            .any(|row| !permitted.contains(row.source_id.as_str()))
        {
            return Err(DENIED.into());
        }
        let mut result = evidence(model, revision, generation)?;
        result["candidateCount"] = selected.len().into();
        result["hits"] = json!(hits
            .into_iter()
            .map(|(chunk_id, score)| json!({"chunkId":chunk_id,"score":score}))
            .collect::<Vec<_>>());
        result["elapsedMs"] = (start.elapsed().as_millis() as u64).into();
        Ok(result)
    })
}

#[path = "embedding_migration.rs"]
pub(super) mod migration;
