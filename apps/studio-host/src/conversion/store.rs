use super::*;
use crate::knowledge::{atomic_bytes, cancel, digest, no_links, scan_conversion, valid_id};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
};
const MAX_ARTIFACT: usize = 240 * 1024 * 1024;
const MAX_META: usize = 32 * 1024 * 1024;
const MAX_PAGE: usize = 4 * 1024 * 1024;
const MAX_CACHE: usize = 16 * 1024 * 1024;
#[derive(Clone)]
pub struct ConversionStore {
    root: PathBuf,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Meta {
    schema_version: String,
    sha256: String,
    bytes: u64,
    header: Value,
    rows: Vec<(u64, usize)>,
}
fn identifier(value: &str, prefix: &str) -> bool {
    value
        .strip_prefix(prefix)
        .is_some_and(|id| id.len() == 64 && id.bytes().all(|c| c.is_ascii_hexdigit()))
}
fn bounded(path: &Path, max: usize) -> Result<Vec<u8>, String> {
    no_links(path)?;
    let file = File::open(path).map_err(|_| IO)?;
    if file.metadata().map_err(|_| IO)?.len() > max as u64 {
        return Err(LIMIT.into());
    }
    let mut bytes = Vec::new();
    file.take(max as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| IO)?;
    if bytes.len() > max {
        return Err(LIMIT.into());
    }
    Ok(bytes)
}
fn lock(path: &Path, name: &str) -> Result<File, String> {
    let path = path.join(name);
    if path.exists() {
        no_links(&path)?;
    }
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(path)
        .map_err(|_| IO)?;
    file.try_lock().map_err(|_| "BLK-CONVERT-BUSY")?;
    Ok(file)
}
impl ConversionStore {
    pub fn new(root: PathBuf) -> Self {
        Self { root }
    }
    pub(super) fn scope(&self, project: &str) -> Result<PathBuf, String> {
        if !valid_id(project) {
            return Err(INVALID.into());
        }
        let path = self.root.join(digest(project.as_bytes()));
        if let Some(existing) = path.ancestors().find(|p| p.exists()) {
            no_links(existing)?;
        }
        fs::create_dir_all(&path).map_err(|_| IO)?;
        no_links(&path)?;
        path.canonicalize().map_err(|_| IO.into())
    }
    pub fn cancel(&self, project: &str) -> Result<(), String> {
        let path = self.scope(project)?;
        atomic_bytes(&path.join("cancel"), uuid::Uuid::new_v4().as_bytes())
    }
    fn metadata(&self, path: &Path, id: &str) -> Result<Meta, String> {
        if !identifier(id, "art-") {
            return Err(INVALID.into());
        }
        let folder = path.join(id);
        if !folder.exists() {
            return Err(DENIED.into());
        }
        let bytes = bounded(&folder.join("metadata.json"), MAX_META)?;
        if format!("art-{}", digest(&bytes)) != id {
            return Err(CORRUPT.into());
        }
        let meta: Meta = serde_json::from_slice(&bytes).map_err(|_| CORRUPT)?;
        if meta.schema_version != "blocky.conversion-artifact/v1"
            || meta.rows.len() > 20000
            || meta.bytes > MAX_ARTIFACT as u64
            || !meta.header["snapshotId"]
                .as_str()
                .is_some_and(|v| identifier(v, "snap-"))
        {
            return Err(CORRUPT.into());
        }
        let snapshot = meta.header["snapshotId"].as_str().ok_or(CORRUPT)?;
        if bounded(&path.join(format!("{snapshot}.ref")), 128)? != id.as_bytes() {
            return Err(CORRUPT.into());
        }
        let mut offset = 0;
        for (start, length) in &meta.rows {
            if *start < offset
                || *length > MAX_PAGE
                || start
                    .checked_add(*length as u64)
                    .is_none_or(|end| end > meta.bytes)
            {
                return Err(CORRUPT.into());
            }
            offset = start + *length as u64;
        }
        Ok(meta)
    }
    fn verified_file(&self, path: &Path, id: &str, meta: &Meta) -> Result<File, String> {
        let file_path = path.join(id).join("snapshot.jsonl");
        no_links(&file_path)?;
        let mut file = File::open(file_path).map_err(|_| IO)?;
        if file.metadata().map_err(|_| IO)?.len() != meta.bytes {
            return Err(CORRUPT.into());
        }
        let mut hash = Sha256::new();
        let mut buffer = vec![0; 256 * 1024];
        loop {
            cancel::check()?;
            let n = file.read(&mut buffer).map_err(|_| IO)?;
            if n == 0 {
                break;
            }
            hash.update(&buffer[..n]);
        }
        if format!("{:x}", hash.finalize()) != meta.sha256 {
            return Err(CORRUPT.into());
        }
        Ok(file)
    }
    fn resolve_snapshot(&self, path: &Path, snapshot: &str) -> Result<(String, Meta), String> {
        if !identifier(snapshot, "snap-") {
            return Err(INVALID.into());
        }
        let reference = path.join(format!("{snapshot}.ref"));
        if !reference.exists() {
            return Err(DENIED.into());
        }
        let id = String::from_utf8(bounded(&reference, 128)?).map_err(|_| CORRUPT)?;
        let meta = self.metadata(path, &id)?;
        if meta.header["snapshotId"] != snapshot {
            return Err(CORRUPT.into());
        }
        self.verified_file(path, &id, &meta)?;
        Ok((id, meta))
    }
    pub fn scan(
        &self,
        project: &str,
        repository: &str,
        reference: Option<&str>,
        subdir: Option<&str>,
    ) -> Result<Value, String> {
        let path = self.scope(project)?;
        let _cancel = cancel::Cancellation::begin(&path);
        let _lock = lock(&path, "scan.lock")?;
        let mut snapshot = scan_conversion(Path::new(repository), reference, subdir)?;
        cancel::check()?;
        let snapshot_id = snapshot["snapshotId"].as_str().ok_or(INVALID)?.to_owned();
        if path.join(format!("{snapshot_id}.ref")).exists() {
            let (id, meta) = self.resolve_snapshot(&path, &snapshot_id)?;
            return Ok(summary(&id, &meta, true));
        }
        let files = match snapshot["files"].take() {
            Value::Array(files) => files,
            _ => return Err(INVALID.into()),
        };
        snapshot.as_object_mut().ok_or(INVALID)?.remove("files");
        let staging = tempfile::tempdir_in(&path).map_err(|_| IO)?;
        let mut file = File::create(staging.path().join("snapshot.jsonl")).map_err(|_| IO)?;
        let mut hash = Sha256::new();
        let mut length = 0u64;
        let mut rows = Vec::with_capacity(files.len());
        let header = serde_json::to_vec(&snapshot).map_err(|_| INVALID)?;
        file.write_all(&header)
            .and_then(|_| file.write_all(b"\n"))
            .map_err(|_| IO)?;
        hash.update(&header);
        hash.update(b"\n");
        length += header.len() as u64 + 1;
        for value in files {
            cancel::check()?;
            let bytes = serde_json::to_vec(&value).map_err(|_| INVALID)?;
            if length + bytes.len() as u64 + 1 > MAX_ARTIFACT as u64 {
                return Err(LIMIT.into());
            }
            rows.push((length, bytes.len()));
            file.write_all(&bytes)
                .and_then(|_| file.write_all(b"\n"))
                .map_err(|_| IO)?;
            hash.update(&bytes);
            hash.update(b"\n");
            length += bytes.len() as u64 + 1;
        }
        file.sync_all().map_err(|_| IO)?;
        drop(file);
        let meta = Meta {
            schema_version: "blocky.conversion-artifact/v1".into(),
            sha256: format!("{:x}", hash.finalize()),
            bytes: length,
            header: snapshot,
            rows,
        };
        let bytes = serde_json::to_vec(&meta).map_err(|_| INVALID)?;
        if bytes.len() > MAX_META {
            return Err(LIMIT.into());
        }
        let id = format!("art-{}", digest(&bytes));
        atomic_bytes(&staging.path().join("metadata.json"), &bytes)?;
        cancel::check()?;
        let destination = path.join(&id);
        if destination.exists() {
            // A crash/cancel after directory rename but before reference
            // publication leaves a complete orphan. Admit it only after the
            // newly scanned metadata and complete artifact bytes match.
            if bounded(&destination.join("metadata.json"), MAX_META)? != bytes {
                return Err(CORRUPT.into());
            }
            self.verified_file(&path, &id, &meta)?;
        } else {
            fs::rename(staging.path(), &destination).map_err(|_| IO)?;
        }
        // The reference is the publication point. Unreferenced directories are unreadable.
        cancel::check()?;
        atomic_bytes(&path.join(format!("{snapshot_id}.ref")), id.as_bytes())?;
        Ok(summary(&id, &meta, false))
    }
    pub fn read(&self, project: &str, id: &str, cursor: usize) -> Result<Value, String> {
        let path = self.scope(project)?;
        let _cancel = cancel::Cancellation::begin(&path);
        let meta = self.metadata(&path, id)?;
        if cursor > meta.rows.len() {
            return Err(INVALID.into());
        }
        let mut file = self.verified_file(&path, id, &meta)?;
        let mut page = meta.header.clone();
        let excluded = page["excluded"].take();
        let all = excluded.as_array().ok_or(CORRUPT)?;
        let mut first = Vec::new();
        let mut excluded_bytes = 0;
        if cursor == 0 {
            for item in all.iter().take(32) {
                let size = serde_json::to_vec(item).map_err(|_| CORRUPT)?.len();
                if excluded_bytes + size > 2048 {
                    break;
                }
                excluded_bytes += size;
                first.push(item.clone());
            }
        }
        let truncated = cursor == 0 && first.len() != all.len();
        page["excluded"] = json!(first);
        page["excludedCount"] = all.len().into();
        page["excludedTruncated"] = truncated.into();
        page["artifactId"] = id.into();
        page["sha256"] = meta.sha256.into();
        page["bytes"] = meta.bytes.into();
        page["files"] = json!([]);
        page["nextCursor"] = Value::Null;
        let mut size = serde_json::to_vec(&page).map_err(|_| CORRUPT)?.len() + 32;
        let mut values = Vec::new();
        let mut next = cursor;
        for (offset, length) in meta.rows.iter().skip(cursor).take(64) {
            cancel::check()?;
            if size + length + 1 > MAX_PAGE {
                break;
            }
            file.seek(SeekFrom::Start(*offset)).map_err(|_| IO)?;
            let mut bytes = vec![0; *length];
            file.read_exact(&mut bytes).map_err(|_| IO)?;
            let value: Value = serde_json::from_slice(&bytes).map_err(|_| CORRUPT)?;
            let content = value["content"].as_str().ok_or(CORRUPT)?;
            if value["bytes"].as_u64() != Some(content.len() as u64)
                || value["sha256"] != digest(content.as_bytes())
            {
                return Err(CORRUPT.into());
            }
            values.push(value);
            size += length + 1;
            next += 1;
        }
        if next == cursor && cursor < meta.rows.len() {
            return Err(LIMIT.into());
        }
        page["files"] = json!(values);
        page["nextCursor"] = if next < meta.rows.len() {
            next.into()
        } else {
            Value::Null
        };
        if serde_json::to_vec(&page).map_err(|_| CORRUPT)?.len() > MAX_PAGE {
            return Err(LIMIT.into());
        }
        cancel::check()?;
        Ok(page)
    }
    pub fn cache_load(&self, project: &str, snapshot: &str) -> Result<Value, String> {
        let path = self.scope(project)?;
        let _cancel = cancel::Cancellation::begin(&path);
        self.resolve_snapshot(&path, snapshot)?;
        let _lock = lock(&path, "cache.lock")?;
        let value = read_cache(&path.join(format!("cache-{snapshot}.json")))?;
        let analysis = read_cache(&path.join("analysis-cache.json"))?;
        let result = json!({"value":value,"analysisCache":analysis});
        if serde_json::to_vec(&result).map_err(|_| CORRUPT)?.len() > MAX_CACHE {
            return Err(LIMIT.into());
        }
        Ok(result)
    }
    pub fn cache_save(
        &self,
        project: &str,
        snapshot: &str,
        value: &Value,
        analysis: Option<&Value>,
    ) -> Result<Value, String> {
        let path = self.scope(project)?;
        let _cancel = cancel::Cancellation::begin(&path);
        self.resolve_snapshot(&path, snapshot)?;
        let _lock = lock(&path, "cache.lock")?;
        let previous;
        let analysis = if let Some(value) = analysis {
            value
        } else {
            previous = read_cache(&path.join("analysis-cache.json"))?;
            &previous
        };
        let size = serde_json::to_vec(&json!({"value":value,"analysisCache":analysis}))
            .map_err(|_| INVALID)?
            .len();
        if size > MAX_CACHE {
            return Err(LIMIT.into());
        }
        cancel::check()?;
        write_cache(&path.join("analysis-cache.json"), analysis)?;
        write_cache(&path.join(format!("cache-{snapshot}.json")), value)?;
        Ok(json!({"saved":true,"snapshotId":snapshot,"bytes":size}))
    }
}
fn summary(id: &str, meta: &Meta, hit: bool) -> Value {
    json!({"artifactId":id,"sha256":meta.sha256,"bytes":meta.bytes,"snapshotId":meta.header["snapshotId"],"commit":meta.header["commit"],"fileCount":meta.rows.len(),"subdir":meta.header["subdir"],"repository":meta.header["repository"],"dirty":meta.header["dirty"],"excludedCount":meta.header["excluded"].as_array().map_or(0,Vec::len),"cacheHit":hit})
}
fn read_cache(path: &Path) -> Result<Value, String> {
    if !path.exists() {
        return Ok(Value::Null);
    }
    let bytes = bounded(path, MAX_CACHE + 1024)?;
    let value: Value = serde_json::from_slice(&bytes).map_err(|_| CORRUPT)?;
    let body = &value["value"];
    if value["sha256"] != digest(&serde_json::to_vec(body).map_err(|_| CORRUPT)?) {
        return Err(CORRUPT.into());
    }
    Ok(body.clone())
}
fn write_cache(path: &Path, value: &Value) -> Result<(), String> {
    let sha = digest(&serde_json::to_vec(value).map_err(|_| INVALID)?);
    atomic_bytes(
        path,
        &serde_json::to_vec(&json!({"sha256":sha,"value":value})).map_err(|_| INVALID)?,
    )
}
