//! Profile-bound encrypted records, short mutation locks and native execution leases.
//! This module does not dispatch effects or accept client-supplied owner/settlement claims.
use super::{
    protocol::{self, INVALID, LIMIT, RECORD_LIMIT, require},
    transition,
};
use crate::process_identity::Identity;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::os::windows::fs::{MetadataExt, OpenOptionsExt};
use std::{
    fs::File,
    io::{Read, Write},
    path::{Path, PathBuf},
    time::{Duration, Instant},
};
const IO: &str = "BLK-WORKFLOW-STORE";
const OWNER: &str = "BLK-WORKFLOW-OWNER";
const MAGIC: &[u8] = b"BLKWF1";
const MAX_FILE: usize = RECORD_LIMIT + 16384;
const MAX_RECORDS: usize = 128;
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Envelope {
    version: u32,
    profile: String,
    record: Value,
    owner: Option<Identity>,
    lease_id: Option<String>,
}
pub struct Store {
    root: PathBuf,
    profile: String,
}
/// Held by the actual native execution process, never a per-write helper process.
/// Dropping it releases the OS lock but preserves the owner evidence on disk.
pub struct Lease<'a> {
    store: &'a Store,
    task_id: String,
    owner: Identity,
    lease_id: String,
    _lock: File,
}
fn regular(path: &Path, max: usize) -> Result<u64, String> {
    let meta = std::fs::symlink_metadata(path).map_err(|_| IO)?;
    require(
        meta.is_file() && meta.file_attributes() & 0x400 == 0 && meta.len() <= max as u64,
        IO,
    )?;
    Ok(meta.len())
}
fn open(path: &Path, lock: bool) -> Result<File, String> {
    let mut options = File::options();
    options
        .read(true)
        .custom_flags(windows_sys::Win32::Storage::FileSystem::FILE_FLAG_OPEN_REPARSE_POINT);
    if lock {
        options.write(true).create(true).truncate(false);
    }
    let file = options.open(path).map_err(|_| IO)?;
    let meta = file.metadata().map_err(|_| IO)?;
    require(
        meta.is_file()
            && meta.file_attributes() & 0x400 == 0
            && meta.len() <= if lock { 0 } else { MAX_FILE as u64 },
        IO,
    )?;
    Ok(file)
}
fn lock(path: &Path) -> Result<File, String> {
    let file = open(path, true)?;
    let start = Instant::now();
    loop {
        match file.try_lock() {
            Ok(()) => return Ok(file),
            Err(std::fs::TryLockError::WouldBlock) => {}
            Err(_) => return Err(IO.into()),
        }
        if start.elapsed() >= Duration::from_millis(250) {
            return Err(OWNER.into());
        }
        std::thread::sleep(Duration::from_millis(5));
    }
}
impl Store {
    /// root is chosen by native startup from the active profile, not request data.
    pub fn new(root: PathBuf) -> Result<Self, String> {
        let root = crate::profile::prepare(&root).map_err(|_| IO)?;
        let profile = crate::profile::identity(&root);
        Ok(Self { root, profile })
    }
    fn check_root(&self) -> Result<(), String> {
        require(
            crate::profile::prepare(&self.root).map_err(|_| IO)? == self.root,
            IO,
        )
    }
    fn lock(&self) -> Result<File, String> {
        self.check_root()?;
        let lock = lock(&self.root.join("workflow.lock"))?;
        super::staging::sweep(&self.root, MAX_FILE)?;
        Ok(lock)
    }
    fn path(&self, id: &str) -> Result<PathBuf, String> {
        require(protocol::stable(id), INVALID)?;
        Ok(self.root.join(format!("task-{id}.bin")))
    }
    fn read_unlocked(&self, id: &str) -> Result<Envelope, String> {
        let path = self.path(id)?;
        regular(&path, MAX_FILE)?;
        let file = open(&path, false)?;
        let mut bytes = Vec::new();
        file.take(MAX_FILE as u64 + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| IO)?;
        require(bytes.len() <= MAX_FILE && bytes.starts_with(MAGIC), IO)?;
        let mut plain = crate::secret_store::crypt(&bytes[MAGIC.len()..], false).map_err(|_| IO)?;
        let result = (|| {
            require(plain.len() <= RECORD_LIMIT + 4096, IO)?;
            let envelope: Envelope =
                serde_json::from_value(crate::strict_json::parse(&plain).map_err(|_| IO)?)
                    .map_err(|_| IO)?;
            require(
                envelope.version == 1 && envelope.profile == self.profile,
                IO,
            )?;
            protocol::parse(&envelope.record)?;
            require(
                envelope.record["taskId"] == id
                    && envelope.owner.is_some() == envelope.lease_id.is_some(),
                IO,
            )?;
            if let Some(owner) = &envelope.owner {
                require(owner.process_id != 0 && owner.created != 0, IO)?;
            }
            if let Some(lease) = &envelope.lease_id {
                require(
                    uuid::Uuid::parse_str(lease).is_ok_and(|v| v.to_string() == *lease),
                    IO,
                )?;
            }
            // Any in-flight effect must retain an attributable execution owner.
            require(
                envelope.record.get("active").is_none() || envelope.owner.is_some(),
                IO,
            )?;
            Ok(envelope)
        })();
        crate::secret_store::wipe(&mut plain);
        result
    }
    fn capacity(&self, replacing: &str, next_len: usize) -> Result<(), String> {
        let mut count = 0;
        let mut bytes = next_len as u64;
        for (index, entry) in std::fs::read_dir(&self.root).map_err(|_| IO)?.enumerate() {
            require(index <= MAX_RECORDS * 2 + 2, LIMIT)?;
            let entry = entry.map_err(|_| IO)?;
            let name = entry.file_name();
            let name = name.to_str().ok_or(IO)?;
            if name == "workflow.lock" {
                regular(&entry.path(), 0)?;
                continue;
            }
            let rest = name.strip_prefix("task-").ok_or(IO)?;
            if let Some(id) = rest.strip_suffix(".lock") {
                require(protocol::stable(id), IO)?;
                regular(&entry.path(), 0)?;
                continue;
            }
            let id = rest.strip_suffix(".bin").ok_or(IO)?;
            require(protocol::stable(id), IO)?;
            let len = regular(&entry.path(), MAX_FILE)?;
            if id != replacing {
                count += 1;
                bytes = bytes.checked_add(len).ok_or(LIMIT)?;
            }
        }
        require(count < MAX_RECORDS && bytes <= 128 * 1024 * 1024, LIMIT)
    }
    fn write_unlocked(&self, envelope: &Envelope) -> Result<(), String> {
        protocol::parse(&envelope.record)?;
        let id = envelope.record["taskId"].as_str().ok_or(INVALID)?;
        let path = self.path(id)?;
        let mut plain = serde_json::to_vec(envelope).map_err(|_| IO)?;
        let encrypted = if plain.len() > RECORD_LIMIT + 4096 {
            Err(LIMIT.into())
        } else {
            crate::secret_store::crypt(&plain, true).map_err(|_| IO.to_string())
        };
        crate::secret_store::wipe(&mut plain);
        let encrypted = encrypted?;
        require(encrypted.len() + MAGIC.len() <= MAX_FILE, LIMIT)?;
        self.capacity(id, encrypted.len() + MAGIC.len())?;
        let mut temp = super::staging::create(&self.root)?;
        temp.write_all(MAGIC)
            .and_then(|_| temp.write_all(&encrypted))
            .and_then(|_| temp.as_file().sync_all())
            .map_err(|_| IO)?;
        let started = Instant::now();
        loop {
            match temp.persist(&path) {
                Ok(_) => return Ok(()),
                Err(error)
                    if matches!(error.error.raw_os_error(), Some(5 | 32 | 33))
                        && started.elapsed() < Duration::from_millis(250) =>
                {
                    temp = error.file;
                    std::thread::sleep(Duration::from_millis(10));
                }
                Err(_) => return Err(IO.into()),
            }
        }
    }
    pub fn create(&self, id: &str, definition: &Value, state: Value) -> Result<Value, String> {
        let record = protocol::create(id, definition, state)?;
        let _lock = self.lock()?;
        match std::fs::symlink_metadata(self.path(id)?) {
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Ok(_) => return Err("BLK-WORKFLOW-CONFLICT".into()),
            Err(_) => return Err(IO.into()),
        }
        self.write_unlocked(&Envelope {
            version: 1,
            profile: self.profile.clone(),
            record: record.clone(),
            owner: None,
            lease_id: None,
        })?;
        Ok(record)
    }
    /// Private execution context. Callers must use summary for logs and UI lists.
    pub fn read(&self, id: &str) -> Result<Value, String> {
        let _lock = self.lock()?;
        Ok(self.read_unlocked(id)?.record)
    }
    pub fn acquire(
        &self,
        id: &str,
        definition: &Value,
        revision: u64,
    ) -> Result<Lease<'_>, String> {
        protocol::definition(definition)?;
        self.path(id)?;
        self.check_root()?;
        // Check existence before creating a lock file, so failed lookups cannot fill the directory.
        regular(&self.path(id)?, MAX_FILE)?;
        let lease_lock = lock(&self.root.join(format!("task-{id}.lock")))?;
        let _lock = self.lock()?;
        let mut envelope = self.read_unlocked(id)?;
        require(
            envelope.record["definition"] == *definition,
            "BLK-WORKFLOW-BINDING",
        )?;
        if let Some(owner) = &envelope.owner {
            require(!owner.is_alive().map_err(|_| OWNER)?, OWNER)?;
        }
        // Owner death alone cannot prove all spawned effects settled. No resolution API yet.
        require(
            envelope.record.get("active").is_none(),
            "BLK-WORKFLOW-UNCERTAIN",
        )?;
        require(
            envelope.record["revision"] == revision,
            "BLK-WORKFLOW-CONFLICT",
        )?;
        let owner = Identity::current().map_err(|_| OWNER)?;
        let lease_id = uuid::Uuid::new_v4().to_string();
        envelope.owner = Some(owner.clone());
        envelope.lease_id = Some(lease_id.clone());
        self.write_unlocked(&envelope)?;
        Ok(Lease {
            store: self,
            task_id: id.into(),
            owner,
            lease_id,
            _lock: lease_lock,
        })
    }
}
impl Lease<'_> {
    fn owned(&self) -> Result<Envelope, String> {
        let envelope = self.store.read_unlocked(&self.task_id)?;
        require(
            envelope.owner.as_ref() == Some(&self.owner)
                && envelope.lease_id.as_ref() == Some(&self.lease_id)
                && Identity::current().map_err(|_| OWNER)? == self.owner,
            OWNER,
        )?;
        Ok(envelope)
    }
    pub fn commit(&mut self, action: &Value) -> Result<Value, String> {
        // Manual reconciliation needs independent operator authorization and process-tree
        // settlement. The native storage boundary cannot synthesize either from JSON.
        require(action["kind"] != "resolve", "BLK-WORKFLOW-UNCERTAIN")?;
        let _lock = self.store.lock()?;
        let mut envelope = self.owned()?;
        envelope.record = transition(&envelope.record, action)?;
        self.store.write_unlocked(&envelope)?;
        Ok(envelope.record)
    }
    /// Called only at a completed durable boundary. Errors and Drop retain owner evidence.
    pub fn release(self) -> Result<(), String> {
        let _lock = self.store.lock()?;
        let mut envelope = self.owned()?;
        require(
            envelope.record.get("active").is_none(),
            "BLK-WORKFLOW-UNCERTAIN",
        )?;
        envelope.owner = None;
        envelope.lease_id = None;
        self.store.write_unlocked(&envelope)
    }
}
