//! Encrypted effect receipts. A journal is evidence, never an execution grant.
use super::{Receipt, binding::Binding, now, protocol::Plan};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    fs::File,
    io::{Read, Write},
    path::PathBuf,
};

const IO: &str = "BLK-RPA-JOURNAL-001";
const BINDING: &str = "BLK-RPA-JOURNAL-002";
const CONFLICT: &str = "BLK-RPA-JOURNAL-003";
const LIMIT: &str = "BLK-RPA-JOURNAL-004";
const MAX_BYTES: usize = 262144;
const MAGIC: &[u8] = b"BLKRJ1";

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Snapshot {
    pub schema_version: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub owner: Option<super::owner::Owner>,
    pub checkpoint_id: String,
    pub revision: u64,
    pub plan_digest: String,
    pub plan: Plan,
    pub target: Binding,
    pub root_id: Vec<i32>,
    pub next: usize,
    pub status: String,
    #[serde(default)]
    pub settled: bool,
    pub receipts: Vec<Receipt>,
    pub updated_at_ms: u64,
}
fn valid_id(id: &str) -> bool {
    id.starts_with("checkpoint-") && id.len() <= 80 && crate::project_store::stable(id)
}
impl Snapshot {
    fn validate(&self) -> Result<(), String> {
        self.plan.validate()?;
        self.target
            .validate_snapshot(&self.plan.target.kind, &self.root_id)?;
        if self.schema_version != "blocky.rpa-journal/v1"
            || !valid_id(&self.checkpoint_id)
            || !(1..=2048).contains(&self.revision)
            || self.plan_digest != crate::agent_data::digest(&self.plan)?
            || self.target.identity() != self.plan.target.identity
            || self.next > self.plan.steps.len()
            || self.receipts.len() > self.plan.steps.len()
            || self.updated_at_ms > 9007199254740991
            || self.settled && (!["completed", "stopped", "failed"].contains(&self.status.as_str())
                || self.status == "completed" && self.next != self.plan.steps.len())
            || self
                .owner
                .as_ref()
                .is_some_and(|o| o.process_id == 0 || o.created == 0)
            || ![
                "ready",
                "running",
                "paused",
                "completed",
                "stopping",
                "stopped",
                "failed",
                "settlement-failed",
                "persistence-failed",
            ]
            .contains(&self.status.as_str())
        {
            return Err(IO.into());
        }
        let mut seen = std::collections::HashSet::new();
        for receipt in &self.receipts {
            let index = self
                .plan
                .steps
                .iter()
                .position(|step| step.step_id == receipt.step_id)
                .ok_or(IO)?;
            if !seen.insert(&receipt.step_id)
                || self.plan.steps[index].effect_key.as_deref() != Some(receipt.effect_key.as_str())
                || receipt.target_identity != self.target.identity()
                || receipt.verified
                || !["uncertain", "completed"].contains(&receipt.status.as_str())
                || (receipt.status == "completed" && index >= self.next)
                || (receipt.status == "uncertain" && index != self.next)
            {
                return Err(IO.into());
            }
        }
        for step in self
            .plan
            .steps
            .iter()
            .take(self.next)
            .filter(|step| step.effect_key.is_some())
        {
            if !self
                .receipts
                .iter()
                .any(|r| r.step_id == step.step_id && r.status == "completed")
            {
                return Err(IO.into());
            }
        }
        Ok(())
    }
    pub fn summary(&self) -> Value {
        let cleanup = super::cleanup::eligible(self);
        json!({"schemaVersion":self.schema_version,"checkpointId":self.checkpoint_id,"revision":self.revision,
            "planId":self.plan.plan_id,"planDigest":self.plan_digest,"targetIdentity":self.target.identity(),
            "status":self.status,"completedSteps":self.next,"totalSteps":self.plan.steps.len(),"receipts":self.receipts,
            "updatedAtMs":self.updated_at_ms,"resumable":super::recovery::eligible(self).is_ok(),"requiresRecoveryApproval":true,
            "settled":self.settled,"deletable":cleanup.is_ok(),"deleteBlockedCode":cleanup.err()})
    }
}
pub struct Store {
    root: PathBuf,
}
pub fn local_root() -> Result<PathBuf, String> {
    std::env::var_os("LOCALAPPDATA")
        .map(|root| PathBuf::from(root).join("ai.blocky.studio/rpa/checkpoints"))
        .ok_or_else(|| IO.into())
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct InspectRequest {
    schema_version: String,
    operation: String,
    checkpoint_id: Option<String>,
    plan: Option<Plan>,
    deletion: Option<super::cleanup::Request>,
}
pub fn dispatch(root: PathBuf, value: Value) -> Result<Value, String> {
    let request: InspectRequest = serde_json::from_value(value).map_err(|_| BINDING)?;
    if request.schema_version != "blocky.project-io/v1alpha1" {
        return Err(BINDING.into());
    }
    let store = Store::new(root);
    if request.operation == "rpa-checkpoint-delete" {
        if request.checkpoint_id.is_some() || request.plan.is_some() { return Err(BINDING.into()); }
        return store.delete(&request.deletion.ok_or(BINDING)?);
    }
    if request.deletion.is_some() { return Err(BINDING.into()); }
    match request.operation.as_str() {
        "rpa-checkpoints" if request.checkpoint_id.is_none() && request.plan.is_none() => {
            Ok(json!(store.summaries()?))
        }
        "rpa-checkpoint" => store.inspect_plan(
            request.checkpoint_id.as_deref().ok_or(BINDING)?,
            request.plan.as_ref(),
        ),
        "rpa-recovery-preview" if request.plan.is_none() => {
            store.recovery_preview(request.checkpoint_id.as_deref().ok_or(BINDING)?)
        }
        _ => Err(BINDING.into()),
    }
}
impl Store {
    pub fn new(root: PathBuf) -> Self {
        Self { root }
    }
    fn lock(&self) -> Result<File, String> {
        std::fs::create_dir_all(&self.root).map_err(|_| IO)?;
        let lock = std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(self.root.join("journal.lock"))
            .map_err(|_| IO)?;
        let start = std::time::Instant::now();
        loop {
            if lock.try_lock().is_ok() {
                return Ok(lock);
            }
            if start.elapsed().as_millis() >= 250 {
                return Err(CONFLICT.into());
            }
            std::thread::sleep(std::time::Duration::from_millis(5));
        }
    }
    fn path(&self, id: &str) -> Result<PathBuf, String> {
        if !valid_id(id) {
            return Err(BINDING.into());
        }
        Ok(self.root.join(format!("{id}.bin")))
    }
    fn files(&self) -> Result<Vec<PathBuf>, String> {
        let mut files = vec![];
        let mut bytes = 0u64;
        for (index, entry) in std::fs::read_dir(&self.root).map_err(|_| IO)?.enumerate() {
            if index >= 128 {
                return Err(LIMIT.into());
            }
            let entry = entry.map_err(|_| IO)?;
            let meta = entry.metadata().map_err(|_| IO)?;
            if !entry.file_type().map_err(|_| IO)?.is_file() {
                return Err(IO.into());
            }
            bytes = bytes.checked_add(meta.len()).ok_or(LIMIT)?;
            if bytes > 64 * 1024 * 1024 - MAX_BYTES as u64 {
                return Err(LIMIT.into());
            }
            if entry.path().extension().is_some_and(|v| v == "bin") {
                files.push(entry.path());
            }
        }
        if files.len() > 100 {
            return Err(LIMIT.into());
        }
        files.sort();
        Ok(files)
    }
    fn read_unlocked(&self, id: &str) -> Result<Snapshot, String> {
        let path = self.path(id)?;
        let meta = std::fs::symlink_metadata(&path).map_err(|_| IO)?;
        if !meta.file_type().is_file() || meta.len() > MAX_BYTES as u64 {
            return Err(IO.into());
        }
        let mut bytes = vec![];
        File::open(path)
            .map_err(|_| IO)?
            .take(MAX_BYTES as u64 + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| IO)?;
        if bytes.len() > MAX_BYTES || !bytes.starts_with(MAGIC) {
            return Err(IO.into());
        }
        let mut plain = crate::secret_store::crypt(&bytes[MAGIC.len()..], false).map_err(|_| IO)?;
        let parsed = if plain.len() <= MAX_BYTES / 2 {
            crate::strict_json::parse(&plain).map_err(|_| IO.to_owned())
        } else {
            Err(LIMIT.into())
        };
        crate::secret_store::wipe(&mut plain);
        let snapshot: Snapshot = serde_json::from_value(parsed?).map_err(|_| IO)?;
        snapshot.validate()?;
        if snapshot.checkpoint_id != id {
            return Err(BINDING.into());
        }
        Ok(snapshot)
    }
    pub(super) fn read_bound(&self, id: &str, plan: &Plan) -> Result<Snapshot, String> {
        let _lock = self.lock()?;
        let saved = self.read_unlocked(id)?;
        if saved.plan_digest != crate::agent_data::digest(plan)? {
            return Err(BINDING.into());
        }
        Ok(saved)
    }
    pub fn inspect(&self, id: &str) -> Result<Value, String> {
        let _lock = self.lock()?;
        Ok(self.read_unlocked(id)?.summary())
    }
    pub fn inspect_plan(&self, id: &str, plan: Option<&Plan>) -> Result<Value, String> {
        match plan {
            Some(plan) => {
                plan.validate()?;
                Ok(self.read_bound(id, plan)?.summary())
            }
            None => self.inspect(id),
        }
    }
    pub fn recovery_preview(&self, id: &str) -> Result<Value, String> {
        let _lock = self.lock()?;
        let saved = self.read_unlocked(id)?;
        super::recovery::eligible(&saved)?;
        Ok(json!({"checkpoint":saved.summary(),"plan":saved.plan}))
    }
    pub fn delete(&self, request: &super::cleanup::Request) -> Result<Value, String> {
        request.validate()?;
        let _lock = self.lock()?;
        let saved = self.read_unlocked(&request.checkpoint_id)?;
        if saved.revision != request.revision { return Err(CONFLICT.into()); }
        super::cleanup::eligible(&saved)?;
        std::fs::remove_file(self.path(&request.checkpoint_id)?).map_err(|_| IO)?;
        Ok(json!({"checkpointId":request.checkpoint_id,"revision":request.revision,"deleted":true}))
    }
    pub fn summaries(&self) -> Result<Vec<Value>, String> {
        let _lock = self.lock()?;
        self.files()?
            .iter()
            .map(|path| {
                self.read_unlocked(path.file_stem().and_then(|s| s.to_str()).ok_or(IO)?)
                    .map(|s| s.summary())
            })
            .collect()
    }
    pub(super) fn save(&self, snapshot: Snapshot, expected_revision: u64) -> Result<u64, String> {
        let _lock = self.lock()?;
        let path = self.path(&snapshot.checkpoint_id)?;
        let files = self.files()?;
        if expected_revision == 0 {
            if path.exists() {
                return Err(CONFLICT.into());
            }
            if files.len() >= 100 {
                return Err(LIMIT.into());
            }
        } else {
            let previous = self.read_unlocked(&snapshot.checkpoint_id)?;
            if previous.revision != expected_revision {
                return Err(CONFLICT.into());
            }
            if previous.plan_digest != snapshot.plan_digest
                || previous.target != snapshot.target
                || previous.root_id != snapshot.root_id
                || previous.owner != snapshot.owner
            {
                return Err(BINDING.into());
            }
        }
        self.write_locked(snapshot, expected_revision, path)
    }
    pub(super) fn claim(&self, saved: &Snapshot) -> Result<Snapshot, String> {
        let _lock = self.lock()?;
        self.files()?;
        let mut current = self.read_unlocked(&saved.checkpoint_id)?;
        if current.revision != saved.revision || current.plan_digest != saved.plan_digest {
            return Err(CONFLICT.into());
        }
        super::recovery::eligible(&current)?;
        current.owner = Some(super::recovery::new_owner()?);
        current.status = "ready".into();
        current.settled = false;
        current.revision = self.write_locked(
            current.clone(),
            current.revision,
            self.path(&current.checkpoint_id)?,
        )?;
        Ok(current)
    }
    fn write_locked(
        &self,
        mut snapshot: Snapshot,
        expected_revision: u64,
        path: PathBuf,
    ) -> Result<u64, String> {
        snapshot.revision = expected_revision.checked_add(1).ok_or(LIMIT)?;
        snapshot.updated_at_ms = now();
        snapshot.validate()?;
        let mut plain = serde_json::to_vec(&snapshot).map_err(|_| IO)?;
        if plain.len() > MAX_BYTES / 2 {
            crate::secret_store::wipe(&mut plain);
            return Err(LIMIT.into());
        }
        let encrypted = crate::secret_store::crypt(&plain, true).map_err(|_| IO);
        crate::secret_store::wipe(&mut plain);
        let encrypted = encrypted?;
        if encrypted.len() + MAGIC.len() > MAX_BYTES {
            return Err(LIMIT.into());
        }
        let mut temp = tempfile::NamedTempFile::new_in(&self.root).map_err(|_| IO)?;
        temp.write_all(MAGIC)
            .and_then(|_| temp.write_all(&encrypted))
            .and_then(|_| temp.as_file().sync_all())
            .map_err(|_| IO)?;
        temp.persist(path).map_err(|_| IO)?;
        Ok(snapshot.revision)
    }
}
