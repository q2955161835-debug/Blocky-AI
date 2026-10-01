//! Durable trigger configuration and at-most-once occurrence reservations. Callers
//! hold the AgentData grant/cancellation lock through mutations. External claims are
//! Host-only after authentication; this store neither authenticates nor runs workflows.
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
const INVALID: &str = "BLK-TRIGGER-REQUEST";
const CORRUPT: &str = "BLK-TRIGGER-CORRUPT";
const CONFLICT: &str = "BLK-TRIGGER-CAS";
const IO: &str = "BLK-TRIGGER-IO";
const LIMIT: &str = "BLK-TRIGGER-LIMIT";
const MAX_BYTES: usize = 8 * 1024 * 1024;
const MAX_REVISION: u64 = 9_007_199_254_740_991;
const MAX_EPOCH: u64 = 8_640_000_000_000_000;
fn digest(b: &[u8]) -> String {
    format!("{:x}", Sha256::digest(b))
}
fn id(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 128
        && s.as_bytes()[0].is_ascii_lowercase()
        && s.split(['.', '-', '_']).all(|p| {
            !p.is_empty()
                && p.bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
        })
}
fn opaque(s: &str) -> bool {
    !s.is_empty() && s.len() <= 512 && !s.chars().any(char::is_control)
}
fn error_code(s: &str) -> bool {
    s.len() <= 128
        && s.starts_with("BLK-")
        && s[4..].split('-').all(|part| {
            !part.is_empty()
                && part
                    .bytes()
                    .all(|b| b.is_ascii_uppercase() || b.is_ascii_digit())
        })
}
fn time_zone(s: &str) -> bool {
    if s == "UTC" {
        return true;
    }
    let b = s.as_bytes();
    b.len() == 6
        && [b'+', b'-'].contains(&b[0])
        && b[3] == b':'
        && [b[1], b[2], b[4], b[5]].iter().all(u8::is_ascii_digit)
        && {
            let h = (b[1] - b'0') * 10 + b[2] - b'0';
            let m = (b[4] - b'0') * 10 + b[5] - b'0';
            h <= 14 && m <= 59 && (h < 14 || m == 0)
        }
}
fn present<'de, D: serde::Deserializer<'de>, T: Deserialize<'de>>(
    d: D,
) -> Result<Option<T>, D::Error> {
    T::deserialize(d).map(Some)
}
fn present_revision<'de, D: serde::Deserializer<'de>>(
    d: D,
) -> Result<Option<Option<u64>>, D::Error> {
    Option::<u64>::deserialize(d).map(Some)
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "lowercase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum Schedule {
    Once {
        starts_at: u64,
        time_zone: String,
        misfire: String,
    },
    Interval {
        starts_at: u64,
        time_zone: String,
        misfire: String,
        interval_ms: u64,
    },
}
impl Schedule {
    fn fields(&self) -> (u64, &str, &str, Option<u64>) {
        match self {
            Self::Once {
                starts_at,
                time_zone,
                misfire,
            } => (*starts_at, time_zone, misfire, None),
            Self::Interval {
                starts_at,
                time_zone,
                misfire,
                interval_ms,
            } => (*starts_at, time_zone, misfire, Some(*interval_ms)),
        }
    }
    fn validate(&self) -> Result<(), String> {
        let (start, zone, misfire, interval) = self.fields();
        if start > MAX_EPOCH
            || !time_zone(zone)
            || !["skip", "latest"].contains(&misfire)
            || interval.is_some_and(|n| !(1000..=31_536_000_000).contains(&n))
        {
            return Err(INVALID.into());
        }
        Ok(())
    }
    fn contains(&self, time: u64) -> bool {
        let (start, _, _, interval) = self.fields();
        time >= start && interval.map_or(time == start, |step| (time - start) % step == 0)
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Config {
    pub schema_version: String,
    pub trigger_id: String,
    pub project_id: String,
    pub module_id: String,
    pub export_id: String,
    pub revision: u64,
    pub enabled: bool,
    #[serde(rename = "type")]
    pub trigger_type: String,
    #[serde(
        default,
        deserialize_with = "present",
        skip_serializing_if = "Option::is_none"
    )]
    pub schedule: Option<Schedule>,
    #[serde(
        default,
        deserialize_with = "present",
        skip_serializing_if = "Option::is_none"
    )]
    pub source_id: Option<String>,
}
impl Config {
    pub fn validate(&self) -> Result<(), String> {
        if self.schema_version != "blocky.trigger/v1"
            || !id(&self.trigger_id)
            || !id(&self.project_id)
            || !id(&self.module_id)
            || !id(&self.export_id)
            || !(1..=MAX_REVISION).contains(&self.revision)
        {
            return Err(INVALID.into());
        }
        match self.trigger_type.as_str() {
            "timer" if self.source_id.is_none() && self.schedule.is_some() => {
                self.schedule.as_ref().unwrap().validate()
            }
            "external" if self.schedule.is_none() && self.source_id.as_deref().is_some_and(id) => {
                Ok(())
            }
            _ => Err(INVALID.into()),
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Occurrence {
    pub occurrence_id: String,
    pub scheduled_at: u64,
    pub kind: String,
    #[serde(
        default,
        deserialize_with = "present",
        skip_serializing_if = "Option::is_none"
    )]
    pub event_id: Option<String>,
}
impl Occurrence {
    fn validate(&self) -> Result<(), String> {
        if !opaque(&self.occurrence_id)
            || self.scheduled_at > MAX_EPOCH
            || !["timer", "external"].contains(&self.kind.as_str())
            || (self.kind == "external") != self.event_id.is_some()
            || self.event_id.as_deref().is_some_and(|s| !id(s))
        {
            return Err(INVALID.into());
        }
        Ok(())
    }
    fn expected_id(&self, project: &str, trigger: &str, revision: u64) -> String {
        let suffix = if self.kind == "timer" {
            format!("timer:{}", self.scheduled_at)
        } else {
            format!("external:{}", self.event_id.as_deref().unwrap_or(""))
        };
        format!("{project}:{trigger}:r{revision}:{suffix}")
    }
    fn matches(&self, c: &Config) -> Result<(), String> {
        self.validate()?;
        if self.kind != c.trigger_type
            || self.occurrence_id != self.expected_id(&c.project_id, &c.trigger_id, c.revision)
            || (self.kind == "timer"
                && !c
                    .schedule
                    .as_ref()
                    .is_some_and(|s| s.contains(self.scheduled_at)))
        {
            return Err("BLK-TRIGGER-BINDING".into());
        }
        Ok(())
    }
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Request {
    pub schema_version: String,
    pub request_id: String,
    pub project_id: String,
    pub session_id: String,
    pub action: String,
    #[serde(
        default,
        deserialize_with = "present",
        skip_serializing_if = "Option::is_none"
    )]
    pub trigger_id: Option<String>,
    #[serde(
        default,
        deserialize_with = "present_revision",
        skip_serializing_if = "Option::is_none"
    )]
    pub expected_revision: Option<Option<u64>>,
    #[serde(
        default,
        deserialize_with = "present",
        skip_serializing_if = "Option::is_none"
    )]
    pub config: Option<Config>,
    #[serde(
        default,
        deserialize_with = "present",
        skip_serializing_if = "Option::is_none"
    )]
    pub paused: Option<bool>,
    #[serde(
        default,
        deserialize_with = "present",
        skip_serializing_if = "Option::is_none"
    )]
    pub occurrence: Option<Occurrence>,
    #[serde(
        default,
        deserialize_with = "present",
        skip_serializing_if = "Option::is_none"
    )]
    pub occurrence_id: Option<String>,
    #[serde(
        default,
        deserialize_with = "present",
        skip_serializing_if = "Option::is_none"
    )]
    pub claim_revision: Option<u64>,
    #[serde(
        default,
        deserialize_with = "present",
        skip_serializing_if = "Option::is_none"
    )]
    pub status: Option<String>,
    #[serde(
        default,
        deserialize_with = "present",
        skip_serializing_if = "Option::is_none"
    )]
    pub workflow_task_id: Option<String>,
    #[serde(
        default,
        deserialize_with = "present",
        skip_serializing_if = "Option::is_none"
    )]
    pub stable_error_code: Option<String>,
}
impl Request {
    pub fn validate(&self) -> Result<(), String> {
        let upsert = self.action == "upsert";
        let pause = self.action == "pause";
        let claim = self.action == "claim";
        let complete = self.action == "complete";
        let target = ["read", "pause", "claim", "complete"].contains(&self.action.as_str());
        if self.schema_version != "blocky.trigger-request/v1"
            || !id(&self.request_id)
            || !id(&self.project_id)
            || !id(&self.session_id)
            || !["list", "read", "upsert", "pause", "claim", "complete"]
                .contains(&self.action.as_str())
            || target != self.trigger_id.is_some()
            || self.trigger_id.as_deref().is_some_and(|s| !id(s))
            || (upsert || pause || claim) != self.expected_revision.is_some()
            || upsert != self.config.is_some()
            || pause != self.paused.is_some()
            || claim != self.occurrence.is_some()
            || complete != self.occurrence_id.is_some()
            || complete != self.claim_revision.is_some()
            || complete != self.status.is_some()
            || (!complete && (self.workflow_task_id.is_some() || self.stable_error_code.is_some()))
            || self
                .expected_revision
                .flatten()
                .is_some_and(|n| n == 0 || n > MAX_REVISION)
            || (pause || claim) && self.expected_revision.flatten().is_none()
            || self.occurrence_id.as_deref().is_some_and(|s| !opaque(s))
            || self
                .claim_revision
                .is_some_and(|n| n == 0 || n > MAX_REVISION)
            || self.workflow_task_id.as_deref().is_some_and(|s| !id(s))
            || self
                .stable_error_code
                .as_deref()
                .is_some_and(|s| !error_code(s))
        {
            return Err(INVALID.into());
        }
        if let Some(c) = &self.config {
            c.validate()?;
            if c.project_id != self.project_id {
                return Err("BLK-TRIGGER-BINDING".into());
            }
        }
        if let Some(o) = &self.occurrence {
            o.validate()?;
        }
        if complete {
            match self.status.as_deref() {
                Some("completed") if self.stable_error_code.is_none() => {}
                Some("failed") if self.stable_error_code.is_some() => {}
                _ => return Err(INVALID.into()),
            }
        }
        Ok(())
    }
    pub fn preflight(&self) -> Result<Value, String> {
        self.validate()?;
        Ok(
            json!({"requestDigest":digest(&serde_json::to_vec(self).map_err(|_|INVALID)?),"projectId":self.project_id,"sessionId":self.session_id,
        "action":self.action,"triggerId":self.trigger_id.as_ref().or(self.config.as_ref().map(|c|&c.trigger_id)),"expectedRevision":self.expected_revision,"claimRevision":self.claim_revision,"occurrenceId":self.occurrence_id.as_ref().or(self.occurrence.as_ref().map(|o|&o.occurrence_id))}),
        )
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Record {
    project_id: String,
    trigger_id: String,
    config_revision: u64,
    module_id: String,
    export_id: String,
    occurrence_id: String,
    scheduled_at: u64,
    kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    event_id: Option<String>,
    claim_revision: u64,
    status: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    workflow_task_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    stable_error_code: Option<String>,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Store {
    schema_version: String,
    configs: BTreeMap<String, Config>,
    occurrences: BTreeMap<String, Record>,
}
fn scope(root: &Path, project: &str) -> Result<PathBuf, String> {
    if !root.is_absolute()
        || root
            .components()
            .any(|c| matches!(c, std::path::Component::ParentDir))
        || !id(project)
    {
        return Err(INVALID.into());
    }
    if let Some(existing) = root.ancestors().find(|p| p.exists()) {
        crate::knowledge::no_links(existing)?;
    }
    let path = root.join(digest(project.as_bytes()));
    fs::create_dir_all(&path).map_err(|_| IO)?;
    crate::knowledge::no_links(&path)?;
    Ok(path)
}
fn load(path: &Path, project: &str) -> Result<Store, String> {
    let mut store = Store {
        schema_version: "blocky.trigger-store/v1".into(),
        configs: BTreeMap::new(),
        occurrences: BTreeMap::new(),
    };
    match fs::symlink_metadata(path) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(store),
        Err(_) => return Err(IO.into()),
        Ok(_) => {}
    }
    let bytes = read_ledger(path)?;
    store = serde_json::from_value(crate::strict_json::parse(&bytes).map_err(|_| CORRUPT)?)
        .map_err(|_| CORRUPT)?;
    if store.schema_version != "blocky.trigger-store/v1"
        || store.configs.len() > 128
        || store.occurrences.len() > 4096
    {
        return Err(CORRUPT.into());
    }
    for (key, c) in &store.configs {
        if c.validate().is_err() || key != &c.trigger_id || c.project_id != project {
            return Err(CORRUPT.into());
        }
    }
    for (key, r) in &store.occurrences {
        let o = Occurrence {
            occurrence_id: r.occurrence_id.clone(),
            scheduled_at: r.scheduled_at,
            kind: r.kind.clone(),
            event_id: r.event_id.clone(),
        };
        if o.validate().is_err()
            || key != &digest(r.occurrence_id.as_bytes())
            || r.project_id != project
            || !id(&r.trigger_id)
            || !id(&r.module_id)
            || !id(&r.export_id)
            || r.config_revision == 0
            || r.config_revision > MAX_REVISION
            || !store
                .configs
                .get(&r.trigger_id)
                .is_some_and(|c| r.config_revision <= c.revision)
            || r.occurrence_id != o.expected_id(project, &r.trigger_id, r.config_revision)
            || r.workflow_task_id.as_deref().is_some_and(|v| !id(v))
            || r.stable_error_code
                .as_deref()
                .is_some_and(|v| !error_code(v))
        {
            return Err(CORRUPT.into());
        }
        let valid = match r.status.as_str() {
            "claimed" => {
                r.claim_revision == 1
                    && r.workflow_task_id.is_none()
                    && r.stable_error_code.is_none()
            }
            "completed" => r.claim_revision == 2 && r.stable_error_code.is_none(),
            "failed" => r.claim_revision == 2 && r.stable_error_code.is_some(),
            _ => false,
        };
        if !valid {
            return Err(CORRUPT.into());
        }
    }
    Ok(store)
}
fn save(path: &Path, store: &Store) -> Result<(), String> {
    let bytes = serde_json::to_vec(store).map_err(|_| INVALID)?;
    if bytes.len() > MAX_BYTES {
        return Err(LIMIT.into());
    }
    if path.exists() {
        read_ledger(path)?;
    }
    crate::knowledge::atomic_bytes(path, &bytes).map_err(|_| IO.into())
}
fn read_ledger(path: &Path) -> Result<Vec<u8>, String> {
    super::media_store::read_bounded(path, MAX_BYTES).map_err(|code| match code.as_str() {
        "BLK-PERM-001" => code,
        "BLK-MEDIA-LIMIT" => LIMIT.into(),
        _ => IO.into(),
    })
}
fn now() -> Result<u64, String> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .map_err(|_| IO.into())
}
fn check_lock_file(file: &fs::File, path: &Path) -> Result<(), String> {
    crate::knowledge::no_links(path)?;
    let metadata = file.metadata().map_err(|_| IO)?;
    if !metadata.is_file() {
        return Err("BLK-PERM-001".into());
    }
    #[cfg(windows)]
    {
        use std::os::windows::{fs::MetadataExt, io::AsRawHandle};
        let mut info =
            windows_sys::Win32::Storage::FileSystem::BY_HANDLE_FILE_INFORMATION::default();
        if metadata.file_attributes() & 0x400 != 0
            || unsafe {
                windows_sys::Win32::Storage::FileSystem::GetFileInformationByHandle(
                    file.as_raw_handle() as _,
                    &mut info,
                )
            } == 0
            || info.nNumberOfLinks != 1
        {
            return Err("BLK-PERM-001".into());
        }
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if metadata.nlink() != 1 {
            return Err("BLK-PERM-001".into());
        }
    }
    Ok(())
}
pub fn manage(root: &Path, r: &Request) -> Result<Value, String> {
    r.validate()?;
    let path = scope(root, &r.project_id)?;
    let lock_path = path.join("triggers.lock");
    let mut options = fs::OpenOptions::new();
    options.read(true).write(true).create(true).truncate(false);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        options.custom_flags(windows_sys::Win32::Storage::FileSystem::FILE_FLAG_OPEN_REPARSE_POINT);
    }
    let lock = options.open(&lock_path).map_err(|_| IO)?;
    // Check the owned handle without reading locked byte ranges through a second
    // handle; a competing Windows lock must surface as BUSY, not a false IO error.
    check_lock_file(&lock, &lock_path)?;
    lock.try_lock().map_err(|_| "BLK-TRIGGER-BUSY")?;
    let file = path.join("triggers.json");
    let mut store = load(&file, &r.project_id)?;
    if r.action == "list" {
        return Ok(
            json!({"triggers":store.configs.values().map(|c|json!({"config":c,"occurrences":store.occurrences.values().filter(|o|o.trigger_id==c.trigger_id).collect::<Vec<_>>()})).collect::<Vec<_>>()}),
        );
    }
    if r.action == "upsert" {
        let c = r.config.as_ref().ok_or(INVALID)?;
        let current = store.configs.get(&c.trigger_id);
        if current.map(|c| c.revision) != r.expected_revision.ok_or(INVALID)?
            || c.revision
                != current
                    .map_or(0, |c| c.revision)
                    .checked_add(1)
                    .filter(|v| *v <= MAX_REVISION)
                    .ok_or(CONFLICT)?
        {
            return Err(CONFLICT.into());
        }
        if current.is_none() && store.configs.len() >= 128 {
            return Err(LIMIT.into());
        }
        store.configs.insert(c.trigger_id.clone(), c.clone());
        save(&file, &store)?;
        return Ok(json!({"config":c}));
    }
    let trigger = r.trigger_id.as_ref().ok_or(INVALID)?;
    if r.action == "read" {
        return store
            .configs
            .get(trigger)
            .map(|c| serde_json::to_value(c).map_err(|_| IO.into()))
            .unwrap_or(Ok(Value::Null));
    }
    let c = store
        .configs
        .get(trigger)
        .ok_or("BLK-TRIGGER-NOT-FOUND")?
        .clone();
    if r.action == "complete" {
        let key = digest(r.occurrence_id.as_ref().ok_or(INVALID)?.as_bytes());
        let record = store
            .occurrences
            .get_mut(&key)
            .ok_or("BLK-TRIGGER-NOT-FOUND")?;
        if record.trigger_id != *trigger || record.project_id != r.project_id {
            return Err("BLK-TRIGGER-BINDING".into());
        }
        if Some(record.claim_revision) != r.claim_revision {
            return Err(CONFLICT.into());
        }
        if record.status != "claimed" {
            return Err("BLK-TRIGGER-SETTLED".into());
        }
        record.status = r.status.as_ref().ok_or(INVALID)?.clone();
        record.claim_revision = 2;
        record.workflow_task_id = r.workflow_task_id.clone();
        record.stable_error_code = r.stable_error_code.clone();
        let result = json!({"record":record});
        save(&file, &store)?;
        return Ok(result);
    }
    if r.expected_revision.flatten() != Some(c.revision) {
        return Err(CONFLICT.into());
    }
    if r.action == "pause" {
        let mut c = c;
        c.enabled = !r.paused.ok_or(INVALID)?;
        c.revision = c
            .revision
            .checked_add(1)
            .filter(|n| *n <= MAX_REVISION)
            .ok_or(CONFLICT)?;
        store.configs.insert(trigger.clone(), c.clone());
        save(&file, &store)?;
        return Ok(json!({"config":c}));
    }
    if !c.enabled {
        return Err("BLK-TRIGGER-DISABLED".into());
    }
    let occurrence = r.occurrence.as_ref().ok_or(INVALID)?;
    occurrence.matches(&c)?;
    let key = digest(occurrence.occurrence_id.as_bytes());
    // Never reclaim an unknown pending effect after restart, nor a failed/completed one.
    if let Some(record) = store.occurrences.get(&key) {
        return Ok(json!({"claimed":false,"record":record}));
    }
    let timestamp = now()?;
    if (occurrence.kind == "timer" && occurrence.scheduled_at > timestamp)
        || (occurrence.kind == "external"
            && (occurrence.scheduled_at > timestamp.saturating_add(30_000)
                || occurrence.scheduled_at < timestamp.saturating_sub(300_000)))
    {
        return Err("BLK-TRIGGER-EVENT-TIME".into());
    }
    if store.occurrences.len() >= 4096 {
        return Err(LIMIT.into());
    }
    let record = Record {
        project_id: c.project_id.clone(),
        trigger_id: c.trigger_id.clone(),
        config_revision: c.revision,
        module_id: c.module_id.clone(),
        export_id: c.export_id.clone(),
        occurrence_id: occurrence.occurrence_id.clone(),
        scheduled_at: occurrence.scheduled_at,
        kind: occurrence.kind.clone(),
        event_id: occurrence.event_id.clone(),
        claim_revision: 1,
        status: "claimed".into(),
        workflow_task_id: None,
        stable_error_code: None,
    };
    let result = json!({"claimed":true,"record":record});
    store.occurrences.insert(key, record);
    save(&file, &store)?;
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> tempfile::TempDir {
        tempfile::tempdir_in(
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("../../try")
                .canonicalize()
                .unwrap(),
        )
        .unwrap()
    }
    fn config() -> Value {
        json!({"schemaVersion":"blocky.trigger/v1","triggerId":"trigger-one","projectId":"project-one","moduleId":"module-one","exportId":"export-one","revision":1,"enabled":true,"type":"timer","schedule":{"kind":"interval","startsAt":1000,"intervalMs":1000,"timeZone":"+08:00","misfire":"latest"}})
    }
    fn request(action: &str, fields: Value) -> Request {
        let mut v = json!({"schemaVersion":"blocky.trigger-request/v1","requestId":"request-one","projectId":"project-one","sessionId":"run-one","action":action});
        v.as_object_mut()
            .unwrap()
            .extend(fields.as_object().unwrap().clone());
        serde_json::from_value(v).unwrap()
    }
    fn create(root: &Path) {
        manage(
            root,
            &request("upsert", json!({"config":config(),"expectedRevision":null})),
        )
        .unwrap();
    }
    fn claim() -> Request {
        request(
            "claim",
            json!({"triggerId":"trigger-one","expectedRevision":1,"occurrence":{"occurrenceId":"project-one:trigger-one:r1:timer:1000","scheduledAt":1000,"kind":"timer"}}),
        )
    }
    #[test]
    fn durable_claim_dedup_unknown_pending_and_project_isolation() {
        let temp = fixture();
        create(temp.path());
        let r = claim();
        let first = manage(temp.path(), &r).unwrap();
        assert_eq!(first["claimed"], true);
        assert_eq!(first["record"]["moduleId"], "module-one");
        let second = manage(temp.path(), &r).unwrap();
        assert_eq!(second["claimed"], false);
        assert_eq!(second["record"], first["record"]);
        let mut other = r;
        other.project_id = "other-project".into();
        assert!(manage(temp.path(), &other).is_err());
        let mut read = request("read", json!({"triggerId":"trigger-one"}));
        read.project_id = "other-project".into();
        assert!(manage(temp.path(), &read).unwrap().is_null());
        let list = manage(temp.path(), &request("list", json!({}))).unwrap();
        assert_eq!(list["triggers"][0]["occurrences"][0]["status"], "claimed");
        assert!(!serde_json::to_string(&list).unwrap().contains("payload"));
    }
    #[test]
    fn pause_upsert_cas_and_revision_reject_old_occurrences() {
        let temp = fixture();
        create(temp.path());
        assert_eq!(
            manage(
                temp.path(),
                &request("upsert", json!({"config":config(),"expectedRevision":null}))
            )
            .unwrap_err(),
            CONFLICT
        );
        let pause = request(
            "pause",
            json!({"triggerId":"trigger-one","expectedRevision":1,"paused":true}),
        );
        assert_eq!(
            manage(temp.path(), &pause).unwrap()["config"]["revision"],
            2
        );
        assert_eq!(manage(temp.path(), &claim()).unwrap_err(), CONFLICT);
        let mut paused = claim();
        paused.expected_revision = Some(Some(2));
        assert_eq!(
            manage(temp.path(), &paused).unwrap_err(),
            "BLK-TRIGGER-DISABLED"
        );
        manage(
            temp.path(),
            &request(
                "pause",
                json!({"triggerId":"trigger-one","expectedRevision":2,"paused":false}),
            ),
        )
        .unwrap();
        let mut stale = claim();
        stale.expected_revision = Some(Some(3));
        assert_eq!(
            manage(temp.path(), &stale).unwrap_err(),
            "BLK-TRIGGER-BINDING"
        );
        let mut c = config();
        c["revision"] = json!(4);
        assert_eq!(
            manage(
                temp.path(),
                &request("upsert", json!({"config":c,"expectedRevision":3}))
            )
            .unwrap()["config"]["revision"],
            4
        );
    }
    #[test]
    fn complete_claim_cas_and_final_state_never_regresses() {
        let temp = fixture();
        create(temp.path());
        let r = claim();
        manage(temp.path(), &r).unwrap();
        let occurrence = r.occurrence.unwrap().occurrence_id;
        let mut done = request(
            "complete",
            json!({"triggerId":"trigger-one","occurrenceId":occurrence,"claimRevision":1,"status":"completed","workflowTaskId":"task-one"}),
        );
        assert_eq!(
            manage(temp.path(), &done).unwrap()["record"]["claimRevision"],
            2
        );
        assert_eq!(manage(temp.path(), &done).unwrap_err(), CONFLICT);
        done.claim_revision = Some(2);
        done.status = Some("failed".into());
        done.stable_error_code = Some("BLK-TRIGGER-RUN".into());
        assert_eq!(
            manage(temp.path(), &done).unwrap_err(),
            "BLK-TRIGGER-SETTLED"
        );
        assert_eq!(manage(temp.path(), &claim()).unwrap()["claimed"], false);
    }
    #[test]
    fn strict_config_metadata_event_ids_and_no_body() {
        let temp = fixture();
        let mut c = config();
        c["projectId"] = json!("other-project");
        assert_eq!(
            request("upsert", json!({"config":c,"expectedRevision":null}))
                .validate()
                .unwrap_err(),
            "BLK-TRIGGER-BINDING"
        );
        let mut c = config();
        c["type"] = json!("external");
        c.as_object_mut().unwrap().remove("schedule");
        c["sourceId"] = json!("source-one");
        manage(
            temp.path(),
            &request("upsert", json!({"config":c,"expectedRevision":null})),
        )
        .unwrap();
        let event = request(
            "claim",
            json!({"triggerId":"trigger-one","expectedRevision":1,"occurrence":{"occurrenceId":"project-one:trigger-one:r1:external:event-one","scheduledAt":now().unwrap(),"kind":"external","eventId":"event-one"}}),
        );
        assert_eq!(manage(temp.path(), &event).unwrap()["claimed"], true);
        let mut wrong = event.clone();
        wrong.occurrence.as_mut().unwrap().event_id = Some("other-event".into());
        assert_eq!(
            manage(temp.path(), &wrong).unwrap_err(),
            "BLK-TRIGGER-BINDING"
        );
        let mut raw = serde_json::to_value(&event).unwrap();
        raw["occurrence"]["payload"] = json!({"body":"synthetic"});
        assert!(serde_json::from_value::<Request>(raw).is_err());
        let mut c = config();
        c["schedule"]["timeZone"] = json!("Asia/Shanghai");
        assert!(
            serde_json::from_value::<Config>(c)
                .unwrap()
                .validate()
                .is_err()
        );
        let mut c = config();
        c["schedule"]["intervalMs"] = json!(999);
        assert!(
            serde_json::from_value::<Config>(c)
                .unwrap()
                .validate()
                .is_err()
        );
        let mut c = config();
        c["sourceId"] = Value::Null;
        assert!(serde_json::from_value::<Config>(c).is_err());
        let mut c = config();
        c["schedule"]["kind"] = json!("once");
        assert!(serde_json::from_value::<Config>(c).is_err());
        let mut raw = serde_json::to_value(claim()).unwrap();
        raw["occurrence"]["moduleId"] = json!("forged-module");
        assert!(serde_json::from_value::<Request>(raw).is_err());
    }
    #[test]
    fn corruption_hardlinks_and_state_fail_closed() {
        let temp = fixture();
        create(temp.path());
        let file = scope(temp.path(), "project-one")
            .unwrap()
            .join("triggers.json");
        let original = fs::read(&file).unwrap();
        fs::write(&file, b"broken").unwrap();
        assert_eq!(manage(temp.path(), &claim()).unwrap_err(), CORRUPT);
        assert_eq!(fs::read(&file).unwrap(), b"broken");
        fs::write(&file, original).unwrap();
        fs::hard_link(&file, temp.path().join("other.json")).unwrap();
        assert_eq!(manage(temp.path(), &claim()).unwrap_err(), "BLK-PERM-001");
    }
    #[cfg(windows)]
    #[test]
    fn failed_atomic_commit_preserves_previous_ledger() {
        use std::os::windows::fs::OpenOptionsExt;
        let temp = fixture();
        create(temp.path());
        let folder = scope(temp.path(), "project-one").unwrap();
        let file = folder.join("triggers.json");
        let original = fs::read(&file).unwrap();
        let held = fs::OpenOptions::new()
            .read(true)
            .share_mode(
                windows_sys::Win32::Storage::FileSystem::FILE_SHARE_READ
                    | windows_sys::Win32::Storage::FileSystem::FILE_SHARE_WRITE,
            )
            .open(&file)
            .unwrap();
        assert_eq!(manage(temp.path(), &claim()).unwrap_err(), IO);
        assert_eq!(fs::read(&file).unwrap(), original);
        drop(held);
        assert_eq!(manage(temp.path(), &claim()).unwrap()["claimed"], true);
        assert_eq!(fs::read_dir(folder).unwrap().count(), 2);
    }
    #[test]
    fn concurrent_claims_have_one_reservation() {
        let temp = fixture();
        create(temp.path());
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(3));
        let mut jobs = Vec::new();
        for _ in 0..2 {
            let root = temp.path().to_path_buf();
            let barrier = barrier.clone();
            jobs.push(std::thread::spawn(move || {
                barrier.wait();
                for _ in 0..200 {
                    match manage(&root, &claim()) {
                        Err(code) if code == "BLK-TRIGGER-BUSY" => {
                            std::thread::sleep(std::time::Duration::from_millis(2))
                        }
                        result => return result,
                    }
                }
                panic!("bounded claim retries exhausted")
            }));
        }
        barrier.wait();
        let values: Vec<_> = jobs
            .into_iter()
            .map(|j| j.join().unwrap().unwrap())
            .collect();
        assert_eq!(values.iter().filter(|v| v["claimed"] == true).count(), 1);
        assert_eq!(values.iter().filter(|v| v["claimed"] == false).count(), 1);
    }
    #[test]
    fn config_occurrence_and_byte_capacity_fail_closed() {
        let temp = fixture();
        create(temp.path());
        let file = scope(temp.path(), "project-one")
            .unwrap()
            .join("triggers.json");
        let mut store = load(&file, "project-one").unwrap();
        let prototype = store.configs["trigger-one"].clone();
        for i in 1..128 {
            let mut c = prototype.clone();
            c.trigger_id = format!("trigger-{i}");
            store.configs.insert(c.trigger_id.clone(), c);
        }
        save(&file, &store).unwrap();
        let previous = fs::read(&file).unwrap();
        let mut c = config();
        c["triggerId"] = json!("trigger-extra");
        assert_eq!(
            manage(
                temp.path(),
                &request("upsert", json!({"config":c,"expectedRevision":null}))
            )
            .unwrap_err(),
            LIMIT
        );
        assert_eq!(fs::read(&file).unwrap(), previous);
        store.configs.retain(|key, _| key == "trigger-one");
        for i in 1..=4096u64 {
            let occurrence_id = format!("project-one:trigger-one:r1:timer:{}", i * 1000);
            let record = Record {
                project_id: "project-one".into(),
                trigger_id: "trigger-one".into(),
                config_revision: 1,
                module_id: "module-one".into(),
                export_id: "export-one".into(),
                occurrence_id: occurrence_id.clone(),
                scheduled_at: i * 1000,
                kind: "timer".into(),
                event_id: None,
                claim_revision: 1,
                status: "claimed".into(),
                workflow_task_id: None,
                stable_error_code: None,
            };
            store
                .occurrences
                .insert(digest(occurrence_id.as_bytes()), record);
        }
        save(&file, &store).unwrap();
        let previous = fs::read(&file).unwrap();
        let mut extra = claim();
        let o = extra.occurrence.as_mut().unwrap();
        o.scheduled_at = 4_097_000;
        o.occurrence_id = "project-one:trigger-one:r1:timer:4097000".into();
        assert_eq!(manage(temp.path(), &extra).unwrap_err(), LIMIT);
        assert_eq!(fs::read(&file).unwrap(), previous);
        fs::OpenOptions::new()
            .write(true)
            .open(&file)
            .unwrap()
            .set_len(MAX_BYTES as u64 + 1)
            .unwrap();
        assert_eq!(
            manage(temp.path(), &request("list", json!({}))).unwrap_err(),
            LIMIT
        );
    }
}
