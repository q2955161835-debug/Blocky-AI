use super::*;
pub(super) fn archive_current(path: &Path) -> Result<(), String> {
    let current = path.join("embedding.json");
    if current.exists() {
        let old: Published = store::read_json(&current, 128 * 1024 * 1024)?;
        validate_shape(&old)?;
        store::atomic_json(
            &path.join(format!("embedding-{}.json", old.model_signature)),
            &old,
        )?;
    }
    Ok(())
}
pub fn status(store: &KnowledgeStore, p: &str, c: &str) -> Result<Value, String> {
    store.locked(p,c,|path,state| {
        let active: Option<Published> = if path.join("embedding.json").exists() { Some(store::read_json(&path.join("embedding.json"),128 * 1024 * 1024)?) } else { None };
        if let Some(active) = &active { validate_shape(active)?; }
        let mut models = Vec::new();
        for id in [embedding_model::MODEL_ID, small_models::EMBED] {
            let signature = embedding_backend::signature(id)?;
            let file = path.join(format!("embedding-{signature}.json"));
            let archived: Option<Published> = if file.exists() { Some(store::read_json(&file,128 * 1024 * 1024)?) } else { None };
            let index = archived.as_ref().or_else(|| active.as_ref().filter(|v| v.model_id == id));
            if let Some(index) = index {
                validate_shape(index)?;
                if index.model_id != id { return Err("BLK-EMBED-CORRUPT".into()); }
                let current = index.index_revision == state.revision && index.generation == state.generation;
                models.push(json!({"modelId":id,"signature":signature,"dimension":index.dimension,"chunkCount":index.rows.len(),"indexRevision":index.index_revision,"generation":index.generation,"compatible":current,"active":active.as_ref().is_some_and(|a| a.model_id == id && a.index_revision == index.index_revision && a.generation == index.generation)}));
            }
        }
        Ok(json!({"models":models,"indexRevision":state.revision,"generation":state.generation}))
    })
}
pub fn activate(
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
    store.locked(p, c, |path, state| {
        versions(state, revision, generation)?;
        let signature = embedding_backend::signature(model)?;
        let file = path.join(format!("embedding-{signature}.json"));
        if !file.exists() {
            return Err("BLK-EMBED-NOT-READY".into());
        }
        let target: Published = store::read_json(&file, 128 * 1024 * 1024)?;
        validate_shape(&target)?;
        if target.model_id != model
            || target.index_revision != revision
            || target.generation != generation
        {
            return Err("BLK-EMBED-NOT-READY".into());
        }
        let allowed: HashSet<_> = state
            .sources
            .iter()
            .filter(|s| s.readable())
            .map(|s| s.source_id.as_str())
            .collect();
        let mut reader = embedding_binary::VectorReader::open(&pack(path, model)?)?;
        for row in &target.rows {
            cancel::check()?;
            if !allowed.contains(row.source_id.as_str()) {
                return Err(DENIED.into());
            }
            reader.read(row.offset, &row.key)?;
        }
        archive_current(path)?;
        cancel::check()?;
        store::atomic_json(&path.join("embedding.json"), &target)?;
        let mut result = evidence(model, revision, generation)?;
        result["activated"] = true.into();
        result["chunkCount"] = target.rows.len().into();
        Ok(result)
    })
}
