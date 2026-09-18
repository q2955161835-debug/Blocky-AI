use super::*;
use serde_json::{Value, json};
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
};

#[derive(Clone)]
pub struct KnowledgeStore {
    pub(crate) root: PathBuf,
}
impl KnowledgeStore {
    pub fn new(root: PathBuf) -> Self {
        Self { root }
    }
    fn scope(&self, project: &str, collection: &str) -> Result<PathBuf, String> {
        if !valid_id(project) || !valid_id(collection) {
            return Err(INVALID.into());
        }
        let path = self
            .root
            .join(digest(project.as_bytes()))
            .join(digest(collection.as_bytes()));
        if let Some(existing) = path.ancestors().find(|p| p.exists()) {
            ingest::no_links(existing)?;
        }
        fs::create_dir_all(&path).map_err(|_| IO)?;
        ingest::no_links(&path)?;
        path.canonicalize().map_err(|_| IO.into())
    }
    fn locked<T>(
        &self,
        project: &str,
        collection: &str,
        f: impl FnOnce(&Path, &mut Collection) -> Result<T, String>,
    ) -> Result<T, String> {
        let path = self.scope(project, collection)?;
        let lock_path = path.join("collection.lock");
        if lock_path.exists() {
            ingest::no_links(&lock_path)?;
        }
        let lock = fs::OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(lock_path)
            .map_err(|_| IO)?;
        lock.try_lock().map_err(|_| "BLK-KNOW-BUSY")?;
        let mut state: Collection = if path.join("manifest.json").exists() {
            read_json(&path.join("manifest.json"), 8 * 1024 * 1024)?
        } else {
            Collection::default()
        };
        f(&path, &mut state)
    }
    pub fn cancel(&self, project: &str, collection: &str) -> Result<(), String> {
        let path = self.scope(project, collection)?;
        atomic_bytes(&path.join("cancel"), uuid::Uuid::new_v4().as_bytes())
    }
    pub fn sources(&self, project: &str, collection: &str) -> Result<Value, String> {
        self.locked(project,collection,|_,state| Ok(json!({"generation":state.generation,"sources":state.sources.iter().map(Source::summary).collect::<Vec<_>>()})))
    }
    pub fn add(
        &self,
        project: &str,
        collection: &str,
        kind: &str,
        location: &str,
        reference: Option<&str>,
    ) -> Result<Value, String> {
        let source = ingest::grant(kind, location, reference)?;
        self.locked(project, collection, |path, state| {
            if let Some(old) = state.sources.iter().find(|s| {
                s.kind == source.kind
                    && s.location == source.location
                    && s.metadata["commit"] == source.metadata["commit"]
            }) {
                return Ok(old.summary());
            }
            if state.sources.len() >= 1024 {
                return Err(LIMIT.into());
            }
            state.sources.push(source.clone());
            add_generation(path, state)?;
            Ok(source.summary())
        })
    }
    pub fn remove(&self, project: &str, collection: &str, id: &str) -> Result<Value, String> {
        self.locked(project, collection, |path, state| {
            let position = state
                .sources
                .iter()
                .position(|s| s.source_id == id)
                .ok_or(DENIED)?;
            state.sources.remove(position);
            invalidate(path, state)?;
            remove_snapshot(path, id)?;
            Ok(json!({"generation":state.generation}))
        })
    }
    pub fn acl(
        &self,
        project: &str,
        collection: &str,
        id: &str,
        principals: Vec<String>,
    ) -> Result<Value, String> {
        if principals.len() > 2
            || principals
                .iter()
                .any(|p| !["local-user", "public"].contains(&p.as_str()))
        {
            return Err(INVALID.into());
        }
        self.locked(project, collection, |path, state| {
            let s = state
                .sources
                .iter_mut()
                .find(|s| s.source_id == id)
                .ok_or(DENIED)?;
            s.allowed_principals = principals;
            let result = s.summary();
            invalidate(path, state)?;
            remove_snapshot(path, id)?;
            Ok(result)
        })
    }
    pub fn read_source(
        &self,
        project: &str,
        collection: &str,
        id: &str,
        cursor: Option<usize>,
        revision: Option<&str>,
    ) -> Result<Value, String> {
        self.locked(project,collection,|path,state| {
            let source = state.sources.iter_mut().find(|s| s.source_id == id && s.readable()).ok_or(DENIED)?;
            let snapshot_path = path.join(format!("snapshot-{id}.json"));
            let snapshot: Snapshot = if cursor.is_none() {
                let _cancel=super::cancel::Cancellation::begin(path);
                if source.kind=="repository" {source.metadata=super::repository::describe(Path::new(&source.location),source.metadata["commit"].as_str())?;}
                let previous = if source.kind=="url" && snapshot_path.exists() {
                    let old:Snapshot=read_json(&snapshot_path,16*1024*1024)?;
                    let mut doc=old.documents.into_iter().next().ok_or(INVALID)?;
                    if doc.revision.len()!=64 || !doc.revision.bytes().all(|c|c.is_ascii_hexdigit()){return Err(INVALID.into());}
                    doc.text=String::from_utf8(read_bounded(&path.join("objects").join(format!("{}.txt",doc.revision)),MAX_DOCUMENT)?).map_err(|_|INVALID)?;
                    if digest(doc.text.as_bytes())!=doc.revision{return Err("BLK-KNOW-CORRUPT".into());}Some(doc)
                }else{None};
                let mut snapshot = ingest::scan(source,previous.as_ref())?;
                let objects = path.join("objects");
                fs::create_dir_all(&objects).map_err(|_| IO)?;
                ingest::no_links(&objects)?;
                for document in &mut snapshot.documents {
                    super::cancel::check()?;
                    let target = objects.join(format!("{}.txt", document.revision));
                    if !target.exists() { atomic_bytes(&target,document.text.as_bytes())?; }
                    document.text.clear();
                }
                atomic_json(&snapshot_path,&snapshot)?;
                source.revision = snapshot.revision.clone();
                atomic_json(&path.join("manifest.json"),state)?;
                snapshot
            } else {
                let snapshot: Snapshot = read_json(&snapshot_path,16*1024*1024)?;
                if revision != Some(snapshot.revision.as_str()) { return Err(STALE.into()); }
                snapshot
            };
            let start = cursor.unwrap_or(0);
            if start > snapshot.documents.len() { return Err(INVALID.into()); }
            let mut documents = Vec::new();
            let mut bytes = 0;
            let mut next = start;
            for entry in snapshot.documents.iter().skip(start).take(128) {
                let mut document = entry.clone();
                if !document.revision.bytes().all(|b|b.is_ascii_hexdigit()) || document.revision.len()!=64 {return Err(INVALID.into());}
                let target = path.join("objects").join(format!("{}.txt",document.revision));
                document.text = String::from_utf8(read_bounded(&target,MAX_DOCUMENT)?).map_err(|_| INVALID)?;
                if digest(document.text.as_bytes()) != document.revision { return Err("BLK-KNOW-CORRUPT".into()); }
                if !documents.is_empty() && bytes + document.text.len() > 4*1024*1024 { break; }
                bytes += document.text.len(); next += 1; documents.push(document);
            }
            let next_cursor = (next < snapshot.documents.len()).then_some(next);
            Ok(json!({"sourceId":id,"generation":state.generation,"documents":documents,"revision":snapshot.revision,"excluded":if start==0 {snapshot.excluded} else {vec![]},"nextCursor":next_cursor}))
        })
    }
    pub fn load_index(&self, project: &str, collection: &str) -> Result<Value, String> {
        self.locked(project, collection, |path, state| {
            let value = match &state.index {
                Some(id) => {
                    if !valid_id(id) {
                        return Err(INVALID.into());
                    }
                    read_json(&path.join(format!("index-{id}.json")), 1024 * 1024 * 1024)?
                }
                None => Value::Null,
            };
            super::index_guard::validate(&value, state)?;
            Ok(json!({"revision":state.revision,"generation":state.generation,"value":value}))
        })
    }
    pub fn save_index(
        &self,
        project: &str,
        collection: &str,
        expected_revision: u64,
        expected_generation: u64,
        value: Value,
    ) -> Result<Value, String> {
        self.locked(project, collection, |path, state| {
            if state.revision != expected_revision || state.generation != expected_generation {
                return Err(STALE.into());
            }
            // A denied source cannot be resurrected through a caller-supplied cache body.
            super::index_guard::validate(&value, state)?;
            let id = uuid::Uuid::new_v4().to_string();
            let target = path.join(format!("index-{id}.json"));
            let bytes = serde_json::to_vec(&value).map_err(|_| INVALID)?;
            if bytes.len() > 1024 * 1024 * 1024 {
                return Err(LIMIT.into());
            }
            atomic_bytes(&target, &bytes)?;
            let old = state.index.replace(id);
            state.revision += 1;
            atomic_json(&path.join("manifest.json"), state)?;
            if let Some(old) = old {
                if valid_id(&old) {
                    let _ = fs::remove_file(path.join(format!("index-{old}.json")));
                }
            }
            Ok(json!({"revision":state.revision,"generation":state.generation}))
        })
    }
}
fn invalidate(path: &Path, state: &mut Collection) -> Result<(), String> {
    let old = state.index.take();
    state.generation += 1;
    state.revision += 1;
    atomic_json(&path.join("manifest.json"), state)?;
    if let Some(old) = old {
        if valid_id(&old) {
            let _ = fs::remove_file(path.join(format!("index-{old}.json")));
        }
    }
    Ok(())
}
fn remove_snapshot(path: &Path, id: &str) -> Result<(), String> {
    if !valid_id(id) {
        return Err(INVALID.into());
    }
    let file = path.join(format!("snapshot-{id}.json"));
    if file.exists() {
        fs::remove_file(file).map_err(|_| IO)?;
    }
    Ok(())
}
fn read_bounded(path: &Path, max: usize) -> Result<Vec<u8>, String> {
    ingest::no_links(path)?;
    let file = fs::File::open(path).map_err(|_| IO)?;
    let mut bytes = Vec::new();
    file.take(max as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| IO)?;
    if bytes.len() > max {
        return Err(LIMIT.into());
    }
    Ok(bytes)
}
fn read_json<T: serde::de::DeserializeOwned>(path: &Path, max: usize) -> Result<T, String> {
    serde_json::from_slice(&read_bounded(path, max)?).map_err(|_| "BLK-KNOW-CORRUPT".into())
}
fn atomic_json(path: &Path, value: &impl serde::Serialize) -> Result<(), String> {
    atomic_bytes(path, &serde_json::to_vec(value).map_err(|_| INVALID)?)
}
fn atomic_bytes(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path.parent().ok_or(IO)?;
    ingest::no_links(parent)?;
    if path.exists() {
        ingest::no_links(path)?;
    }
    let mut temp = tempfile::NamedTempFile::new_in(parent).map_err(|_| IO)?;
    temp.write_all(bytes)
        .and_then(|_| temp.as_file().sync_all())
        .map_err(|_| IO)?;
    temp.persist(path).map_err(|_| IO)?;
    Ok(())
}
fn add_generation(path: &Path, state: &mut Collection) -> Result<(), String> {
    state.generation += 1;
    state.revision += 1;
    if let Some(old) = state.index.clone() {
        if !valid_id(&old) {
            return Err(INVALID.into());
        }
        let mut value: Value =
            read_json(&path.join(format!("index-{old}.json")), 1024 * 1024 * 1024)?;
        if let Some(index) = value.get_mut("index").filter(|v| v.is_object()) {
            index["generation"] = state.generation.into();
        }
        if let Some(index) = value
            .get_mut("pending")
            .and_then(|v| v.get_mut("index"))
            .filter(|v| v.is_object())
        {
            index["generation"] = state.generation.into();
        }
        let id = uuid::Uuid::new_v4().to_string();
        atomic_json(&path.join(format!("index-{id}.json")), &value)?;
        state.index = Some(id);
        atomic_json(&path.join("manifest.json"), state)?;
        let _ = fs::remove_file(path.join(format!("index-{old}.json")));
    } else {
        atomic_json(&path.join("manifest.json"), state)?;
    }
    Ok(())
}
