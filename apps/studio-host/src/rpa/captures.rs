//! Short-lived encrypted images. IDs are profile-local references, never paths or grants.
use base64::{Engine, engine::general_purpose::STANDARD};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{fs::File, io::{Read, Write}, path::{Path, PathBuf}, time::{Duration, Instant}};
use super::capture_png;
const IO: &str = "BLK-RPA-CAPTURE-001";
const INVALID: &str = "BLK-RPA-CAPTURE-002";
const LIMIT: &str = "BLK-RPA-CAPTURE-003";
const EXPIRED: &str = "BLK-RPA-CAPTURE-004";
const MAGIC: &[u8] = b"BLKCAP1";
const MAX_FILE: usize = capture_png::LIMIT + 8192;
const TTL: u64 = 24 * 60 * 60 * 1000;
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
pub struct Capture {
    pub schema_version: String, pub capture_id: String, pub checkpoint_id: String,
    pub plan_id: String, pub step_id: String, pub created_at: u64, pub expires_at: u64,
    pub width: u32, pub height: u32, pub bytes: usize, pub sha256: String, pub masked_regions: u32,
}
fn valid_id(id: &str) -> bool {
    id.strip_prefix("capture-").and_then(|s| uuid::Uuid::parse_str(s).ok()).is_some_and(|v| format!("capture-{v}") == id)
}
fn stable(id: &str) -> bool { id.len() <= 200 && crate::project_store::stable(id) }
impl Capture {
    fn valid(&self) -> bool {
        self.schema_version == "blocky.rpa-capture/v1" && valid_id(&self.capture_id)
            && self.checkpoint_id.starts_with("checkpoint-") && self.checkpoint_id.len() <= 80 && stable(&self.checkpoint_id)
            && stable(&self.plan_id) && stable(&self.step_id) && self.created_at <= 9007199254740991 - TTL
            && self.expires_at == self.created_at + TTL && (1..=2048).contains(&self.width) && (1..=2048).contains(&self.height)
            && self.bytes > 0 && self.bytes <= capture_png::LIMIT && self.masked_regions <= 2048
            && self.sha256.len() == 64 && self.sha256.bytes().all(|v| v.is_ascii_digit() || (b'a'..=b'f').contains(&v))
    }
}
pub struct Store { root: PathBuf }
impl Store {
    pub fn new(root: PathBuf) -> Self { Self { root } }
    fn lock(&self) -> Result<File, String> {
        crate::profile::prepare(&self.root).map_err(|_| IO)?;
        let path = self.root.join("captures.lock");
        if path.exists() { regular(&path, 0)?; }
        use std::os::windows::fs::{OpenOptionsExt,MetadataExt};
        let lock = File::options().read(true).write(true).create(true).truncate(false).custom_flags(windows_sys::Win32::Storage::FileSystem::FILE_FLAG_OPEN_REPARSE_POINT).open(path).map_err(|_| IO)?;
        let meta=lock.metadata().map_err(|_|IO)?;
        if !meta.is_file()||meta.len()!=0||meta.file_attributes()&0x400!=0{return Err(IO.into());}
        let start = Instant::now();
        loop {
            if lock.try_lock().is_ok() { return Ok(lock); }
            if start.elapsed() >= Duration::from_millis(250) { return Err(IO.into()); }
            std::thread::sleep(Duration::from_millis(5));
        }
    }
    fn path(&self, id: &str) -> Result<PathBuf, String> {
        if !valid_id(id) { return Err(INVALID.into()); }
        Ok(self.root.join(format!("{id}.bin")))
    }
    fn read_unlocked(&self, id: &str) -> Result<(Capture, Vec<u8>), String> {
        let bytes = read_bounded(&self.path(id)?, MAX_FILE)?;
        if !bytes.starts_with(MAGIC) { return Err(IO.into()); }
        let mut plain = crate::secret_store::crypt(&bytes[MAGIC.len()..], false).map_err(|_| IO)?;
        let result = (|| {
            if plain.len() < 4 || plain.len() > capture_png::LIMIT + 4096 { return Err(IO.into()); }
            let end = 4 + u32::from_le_bytes(plain[..4].try_into().map_err(|_| IO)?) as usize;
            if end > 4096 || end >= plain.len() { return Err(IO.into()); }
            let meta: Capture = serde_json::from_value(crate::strict_json::parse(&plain[4..end]).map_err(|_| IO)?).map_err(|_| IO)?;
            let png = &plain[end..];
            if !meta.valid() || meta.capture_id != id || meta.bytes != png.len() || meta.sha256 != format!("{:x}", Sha256::digest(png)) { return Err(IO.into()); }
            Ok((meta, png.to_vec()))
        })();
        crate::secret_store::wipe(&mut plain); result
    }
    fn scan(&self, now: u64) -> Result<Vec<Capture>, String> {
        let mut results = vec![]; let mut total = 0u64;
        for (index, entry) in std::fs::read_dir(&self.root).map_err(|_| IO)?.enumerate() {
            if index >= 64 { return Err(LIMIT.into()); }
            let entry = entry.map_err(|_| IO)?;
            if entry.file_name() == "captures.lock" { continue; }
            let path = entry.path();
            // NamedTempFile writes are under the same lock; unexpected files are never removed.
            let id = path.file_stem().and_then(|v| v.to_str()).ok_or(IO)?;
            if path.extension().is_none_or(|v| v != "bin") || !valid_id(id) { return Err(IO.into()); }
            total = total.checked_add(regular(&path, MAX_FILE)?).ok_or(LIMIT)?;
            if total > 128 * 1024 * 1024 { return Err(LIMIT.into()); }
            let (meta, mut png) = self.read_unlocked(id)?;
            crate::secret_store::wipe(&mut png);
            if meta.expires_at <= now { std::fs::remove_file(path).map_err(|_| IO)?; }
            else { results.push(meta); }
        }
        if results.len() > 32 { return Err(LIMIT.into()); }
        results.sort_by_key(|m| std::cmp::Reverse(m.created_at)); Ok(results)
    }
    pub fn list(&self) -> Result<Vec<Capture>, String> { let _lock = self.lock()?; self.scan(super::now()) }
    pub fn save(&self, checkpoint: &str, plan: &str, step: &str, bytes: &[u8], masked: u32) -> Result<Capture, String> {
        self.save_at(checkpoint, plan, step, bytes, masked, super::now())
    }
    fn save_at(&self, checkpoint: &str, plan: &str, step: &str, bytes: &[u8], masked: u32, now: u64) -> Result<Capture, String> {
        let (mut png, width, height) = capture_png::normalize(bytes)?;
        let result = (|| {
            let meta = Capture { schema_version:"blocky.rpa-capture/v1".into(), capture_id:format!("capture-{}",uuid::Uuid::new_v4()), checkpoint_id:checkpoint.into(), plan_id:plan.into(), step_id:step.into(), created_at:now, expires_at:now.checked_add(TTL).ok_or(INVALID)?, width, height, bytes:png.len(), sha256:format!("{:x}",Sha256::digest(&png)), masked_regions:masked };
            if !meta.valid() { return Err(INVALID.into()); }
            let _lock = self.lock()?;
            let existing = self.scan(now)?;
            if existing.len() >= 32 || existing.iter().map(|v| v.bytes + 8192).sum::<usize>() + png.len() + 8192 > 128 * 1024 * 1024 { return Err(LIMIT.into()); }
            let header = serde_json::to_vec(&meta).map_err(|_| IO)?;
            let mut plain = Vec::with_capacity(header.len() + png.len() + 4);
            plain.extend_from_slice(&(header.len() as u32).to_le_bytes()); plain.extend_from_slice(&header); plain.extend_from_slice(&png);
            let encrypted = crate::secret_store::crypt(&plain, true).map_err(|_| IO);
            crate::secret_store::wipe(&mut plain); let encrypted = encrypted?;
            if encrypted.len() + MAGIC.len() > MAX_FILE { return Err(LIMIT.into()); }
            let mut file = tempfile::NamedTempFile::new_in(&self.root).map_err(|_| IO)?;
            file.write_all(MAGIC).and_then(|_| file.write_all(&encrypted)).and_then(|_| file.as_file().sync_all()).map_err(|_| IO)?;
            file.persist_noclobber(self.path(&meta.capture_id)?).map_err(|_| IO)?;
            Ok(meta)
        })();
        crate::secret_store::wipe(&mut png); result
    }
    pub fn read(&self, id: &str) -> Result<(Capture, Vec<u8>), String> {
        self.path(id)?; let _lock = self.lock()?; let (meta, mut png) = self.read_unlocked(id)?;
        if meta.expires_at <= super::now() { crate::secret_store::wipe(&mut png); std::fs::remove_file(self.path(id)?).map_err(|_| IO)?; return Err(EXPIRED.into()); }
        let normalized = capture_png::normalize(&png); crate::secret_store::wipe(&mut png);
        let (png, w, h) = normalized?;
        if w != meta.width || h != meta.height { return Err(IO.into()); }
        Ok((meta, png))
    }
    pub fn view(&self, id: &str) -> Result<Value, String> {
        let (meta, mut png) = self.read(id)?;
        let data = STANDARD.encode(&png); crate::secret_store::wipe(&mut png);
        Ok(json!({"capture":meta,"dataUrl":format!("data:image/png;base64,{data}")}))
    }
    pub fn delete(&self, id: &str) -> Result<Value, String> {
        let path = self.path(id)?; let _lock = self.lock()?; regular(&path, MAX_FILE)?;
        std::fs::remove_file(path).map_err(|_| IO)?; Ok(json!({"captureId":id,"deleted":true}))
    }
    pub(super) fn staging(&self) -> Result<tempfile::TempDir, String> {
        let root = self.root.parent().ok_or(IO)?.join("capture-staging");
        crate::profile::prepare(&root).map_err(|_| IO)?;
        tempfile::tempdir_in(root).map_err(|_| IO.into())
    }
}
pub(super) fn read_bounded(path: &Path, max: usize) -> Result<Vec<u8>, String> {
    regular(path, max)?;
    use std::os::windows::fs::OpenOptionsExt;
    let file = File::options().read(true).custom_flags(windows_sys::Win32::Storage::FileSystem::FILE_FLAG_OPEN_REPARSE_POINT).open(path).map_err(|_| IO)?;
    let meta = file.metadata().map_err(|_| IO)?;
    use std::os::windows::fs::MetadataExt;
    if !meta.is_file() || meta.file_attributes() & 0x400 != 0 || meta.len() > max as u64 { return Err(IO.into()); }
    let mut bytes = vec![]; file.take(max as u64 + 1).read_to_end(&mut bytes).map_err(|_| IO)?;
    if bytes.len() > max { return Err(LIMIT.into()); } Ok(bytes)
}
fn regular(path: &Path, max: usize) -> Result<u64, String> {
    use std::os::windows::fs::MetadataExt;
    let meta = std::fs::symlink_metadata(path).map_err(|_| IO)?;
    if !meta.is_file() || meta.file_attributes() & 0x400 != 0 || meta.len() > max as u64 { return Err(IO.into()); } Ok(meta.len())
}
pub fn dispatch(root: PathBuf, input: Value) -> Result<Value, String> {
    #[derive(Deserialize)] #[serde(rename_all="camelCase",deny_unknown_fields)]
    struct Request { schema_version:String, operation:String, capture_id:Option<String> }
    let request: Request = serde_json::from_value(input).map_err(|_| INVALID)?;
    if request.schema_version != "blocky.project-io/v1alpha1" { return Err(INVALID.into()); }
    let store = Store::new(root);
    match request.operation.as_str() {
        "rpa-captures" if request.capture_id.is_none() => Ok(json!(store.list()?)),
        "rpa-capture-read" => store.view(request.capture_id.as_deref().ok_or(INVALID)?),
        "rpa-capture-delete" => store.delete(request.capture_id.as_deref().ok_or(INVALID)?),
        _ => Err(INVALID.into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn capture_is_encrypted_bounded_expiring_and_not_a_path() {
        let temp = crate::rpa::tests::journal_directory();
        let store = Store::new(std::path::absolute(temp.path()).unwrap().join("captures"));
        let png = capture_png::encode(2, 1, &[255,0,0,255,0,0,0,255]).unwrap();
        let meta = store.save("checkpoint-one", "plan", "shot", &png, 1).unwrap();
        assert_eq!(store.list().unwrap().len(), 1);
        let (read, bytes) = store.read(&meta.capture_id).unwrap();
        assert_eq!(read.sha256, meta.sha256); assert_eq!(bytes, png);
        assert!(!std::fs::read(store.path(&meta.capture_id).unwrap()).unwrap().windows(8).any(|w| w == &png[..8]));
        assert_eq!(store.read("../outside").unwrap_err(), INVALID);
        assert!(store.save("checkpoint-one", "plan", "shot", b"not a PNG", 0).is_err());
        assert!(capture_png::encode(2049, 1, &vec![0; 2049*4]).is_err());
        store.delete(&meta.capture_id).unwrap();
        let expired = store.save_at("checkpoint-one", "plan", "old", &png, 0, 1).unwrap();
        assert_eq!(store.read(&expired.capture_id).unwrap_err(), EXPIRED);
        assert!(store.list().unwrap().is_empty());
        for _ in 0..32 { store.save("checkpoint-one", "plan", "shot", &png, 0).unwrap(); }
        assert_eq!(store.save("checkpoint-one", "plan", "shot", &png, 0).unwrap_err(), LIMIT);
        let id = store.list().unwrap()[0].capture_id.clone();
        std::fs::write(store.path(&id).unwrap(), b"corrupt").unwrap();
        assert!(store.list().is_err()); assert!(store.read(&id).is_err());
        store.delete(&id).unwrap(); assert_eq!(store.list().unwrap().len(), 31);
    }
}
