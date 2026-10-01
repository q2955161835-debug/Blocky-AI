//! Atomic profile/project evaluation assets. Caller holds the AgentData grant and
//! cancellation lock through `manage`. Keys are opaque JSON strings, never paths.
//! This Host boundary validates storage/state invariants; the typed TS adapter remains
//! responsible for the complete evaluation/scoring schemas and semantic checks.
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
};
const INVALID: &str = "BLK-EVAL-HOST-REQUEST";
const CORRUPT: &str = "BLK-EVAL-HOST-CORRUPT";
const CONFLICT: &str = "BLK-EVAL-ASSET-CONFLICT";
const IMMUTABLE: &str = "BLK-EVAL-ASSET-IMMUTABLE";
const IO: &str = "BLK-EVAL-HOST-IO";
const LIMIT: &str = "BLK-EVAL-HOST-LIMIT";
const PERMISSION: &str = "BLK-PERM-001";
const MAX_ASSET: usize = 8 * 1024 * 1024;
const MAX_STORE: usize = 64 * 1024 * 1024;
const MAX_ENTRIES: usize = 512;
const MAX_REVISION: u64 = 9_007_199_254_740_991;
fn sha(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn id(v: &str) -> bool {
    !v.is_empty()
        && v.len() <= 128
        && v.as_bytes()[0].is_ascii_lowercase()
        && v.split(['.', '_', '-']).all(|p| {
            !p.is_empty()
                && p.bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
        })
}
fn key(v: &str) -> bool {
    !v.is_empty()
        && v.encode_utf16().count() <= 256
        && !v.chars().any(|c| c <= '\u{1f}' || c == '\u{7f}')
}
fn kind(v: &str) -> bool {
    ["dataset", "report", "checkpoint"].contains(&v)
}
fn hash(v: &Value) -> bool {
    v.as_str().is_some_and(|s| {
        s.len() == 64
            && s.bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    })
}
fn stamp(v: &Value) -> bool {
    v.as_u64().is_some_and(|n| n <= MAX_REVISION)
}
fn identity(v: &Value) -> bool {
    v.as_str().is_some_and(id)
}
fn text(v: &Value, limit: usize) -> bool {
    v.as_str()
        .is_some_and(|s| !s.is_empty() && s.encode_utf16().count() <= limit && !s.contains('\0'))
}
fn present_revision<'de, D: serde::Deserializer<'de>>(
    d: D,
) -> Result<Option<Option<u64>>, D::Error> {
    Option::<u64>::deserialize(d).map(Some)
}
fn present_value<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Option<Value>, D::Error> {
    Value::deserialize(d).map(Some)
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Request {
    pub schema_version: String,
    pub request_id: String,
    pub project_id: String,
    pub session_id: String,
    pub action: String,
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub key: Option<String>,
    #[serde(
        default,
        deserialize_with = "present_revision",
        skip_serializing_if = "Option::is_none"
    )]
    pub expected_revision: Option<Option<u64>>,
    #[serde(
        default,
        deserialize_with = "present_value",
        skip_serializing_if = "Option::is_none"
    )]
    pub value: Option<Value>,
}
impl Request {
    pub fn validate(&self) -> Result<(), String> {
        let cas = self.action == "cas";
        let existing = ["cas", "read"].contains(&self.action.as_str());
        if self.schema_version != "blocky.evaluation-asset-request/v1"
            || !id(&self.request_id)
            || !id(&self.project_id)
            || !id(&self.session_id)
            || !(existing || self.action == "list")
            || !kind(&self.kind)
            || existing != self.key.is_some()
            || self.key.as_deref().is_some_and(|v| !key(v))
            || cas != self.expected_revision.is_some()
            || cas != self.value.is_some()
            || self
                .expected_revision
                .flatten()
                .is_some_and(|n| n > MAX_REVISION)
        {
            return Err(INVALID.into());
        }
        if let Some(value) = &self.value {
            validate_value(&self.kind, value)?;
        }
        Ok(())
    }
    pub fn preflight(&self) -> Result<Value, String> {
        self.validate()?;
        Ok(
            json!({"requestDigest":sha(&serde_json::to_vec(self).map_err(|_|INVALID)?),
        "projectId":self.project_id,"sessionId":self.session_id,"action":self.action,"kind":self.kind,"key":self.key,"expectedRevision":self.expected_revision,
        "valueBytes":self.value.as_ref().map(|v|serde_json::to_vec(v).map(|b|b.len())).transpose().map_err(|_|INVALID)?}),
        )
    }
}
fn validate_binding(value: &Value) -> bool {
    let model = &value["model"];
    value.is_object()
        && hash(&value["configurationHash"])
        && model.is_object()
        && identity(&model["resourceId"])
        && text(&model["provider"], 128)
        && text(&model["modelId"], 256)
        && text(&model["version"], 128)
}
fn validate_value(asset_kind: &str, v: &Value) -> Result<(), String> {
    if serde_json::to_vec(v).map_err(|_| INVALID)?.len() > MAX_ASSET {
        return Err(LIMIT.into());
    }
    let object = v.as_object().ok_or(INVALID)?;
    if v["schemaVersion"] != format!("blocky.evaluation-{asset_kind}/v1")
        || !validate_binding(&v["binding"])
        || !stamp(&v["createdAt"])
    {
        return Err(INVALID.into());
    }
    let allowed: &[&str] = match asset_kind {
        "dataset" => &[
            "schemaVersion",
            "datasetId",
            "version",
            "name",
            "createdAt",
            "frozenAt",
            "status",
            "binding",
            "cases",
            "contentHash",
            "bindingHash",
        ],
        "report" => &[
            "schemaVersion",
            "reportId",
            "checkpointId",
            "datasetId",
            "datasetVersion",
            "datasetContentHash",
            "binding",
            "candidate",
            "resultDetailPolicy",
            "status",
            "createdAt",
            "updatedAt",
            "completedAt",
            "rows",
            "metrics",
            "scoring",
        ],
        "checkpoint" => &[
            "schemaVersion",
            "checkpointId",
            "reportId",
            "datasetId",
            "datasetVersion",
            "datasetContentHash",
            "binding",
            "candidate",
            "resultDetailPolicy",
            "status",
            "createdAt",
            "updatedAt",
            "cases",
            "modelScoring",
        ],
        _ => return Err(INVALID.into()),
    };
    if object.keys().any(|k| !allowed.contains(&k.as_str())) {
        return Err(INVALID.into());
    }
    if asset_kind == "dataset" {
        let cases = v["cases"].as_array().ok_or(INVALID)?;
        if !identity(&v["datasetId"])
            || !v["version"]
                .as_u64()
                .is_some_and(|n| (1..=65535).contains(&n))
            || !v["name"]
                .as_str()
                .is_some_and(|s| !s.trim().is_empty() && s.encode_utf16().count() <= 128)
            || cases.is_empty()
            || cases.len() > 10000
            || cases.iter().any(|c| {
                !identity(&c["caseId"]) || !c.as_object().is_some_and(|o| o.contains_key("input"))
            })
        {
            return Err(INVALID.into());
        }
        match v["status"].as_str() {
            Some("draft")
                if !object.contains_key("contentHash")
                    && !object.contains_key("bindingHash")
                    && !object.contains_key("frozenAt") => {}
            Some("frozen")
                if hash(&v["contentHash"]) && hash(&v["bindingHash"]) && stamp(&v["frozenAt"]) => {}
            _ => return Err(INVALID.into()),
        }
    } else {
        if !identity(&v["reportId"])
            || !identity(&v["checkpointId"])
            || !identity(&v["datasetId"])
            || !v["datasetVersion"]
                .as_u64()
                .is_some_and(|n| (1..=65535).contains(&n))
            || !hash(&v["datasetContentHash"])
            || !v["candidate"].is_object()
            || !identity(&v["candidate"]["id"])
            || !text(&v["candidate"]["version"], 128)
            || !hash(&v["candidate"]["contentHash"])
            || !v["resultDetailPolicy"]
                .as_str()
                .is_some_and(|s| ["summary", "structured"].contains(&s))
            || !stamp(&v["updatedAt"])
        {
            return Err(INVALID.into());
        }
        if asset_kind == "report" {
            if !v["rows"].as_array().is_some_and(|a| a.len() <= 10000)
                || !v["metrics"].is_object()
                || !v["scoring"].is_object()
            {
                return Err(INVALID.into());
            }
            match v["status"].as_str() {
                Some("partial") if !object.contains_key("completedAt") => {}
                Some("completed")
                    if stamp(&v["completedAt"])
                        && v["completedAt"].as_u64() >= v["createdAt"].as_u64() => {}
                _ => return Err(INVALID.into()),
            }
        } else {
            if !v["status"]
                .as_str()
                .is_some_and(|s| ["running", "cancelled", "completed"].contains(&s))
                || !v["cases"]
                    .as_array()
                    .is_some_and(|a| !a.is_empty() && a.len() <= 10000)
                || !v["modelScoring"].is_object()
            {
                return Err(INVALID.into());
            }
        }
    }
    Ok(())
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Asset {
    kind: String,
    key: String,
    revision: u64,
    value: Value,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Store {
    schema_version: String,
    assets: BTreeMap<String, Asset>,
}
fn regular(path: &Path) -> Result<(), String> {
    crate::knowledge::no_links(path).map_err(|_| PERMISSION.to_owned())
}
fn file_options() -> fs::OpenOptions {
    let mut options = fs::OpenOptions::new();
    options.read(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        options.custom_flags(windows_sys::Win32::Storage::FileSystem::FILE_FLAG_OPEN_REPARSE_POINT);
    }
    options
}
fn checked_file(file: &fs::File) -> Result<(), String> {
    let metadata = file.metadata().map_err(|_| IO)?;
    if !metadata.is_file() {
        return Err(PERMISSION.into());
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
            return Err(PERMISSION.into());
        }
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if metadata.nlink() != 1 {
            return Err(PERMISSION.into());
        }
    }
    Ok(())
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
        regular(existing)?;
    }
    let path = root.join(sha(project.as_bytes()));
    fs::create_dir_all(&path).map_err(|_| IO)?;
    regular(&path)?;
    Ok(path)
}
fn asset_key(asset_kind: &str, key: &str) -> String {
    sha(&serde_json::to_vec(&(asset_kind, key)).unwrap())
}
fn load(path: &Path) -> Result<Store, String> {
    let file = match file_options().open(path) {
        Ok(f) => f,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Ok(Store {
                schema_version: "blocky.evaluation-store/v1".into(),
                assets: BTreeMap::new(),
            });
        }
        Err(_) => return Err(IO.into()),
    };
    regular(path)?;
    checked_file(&file)?;
    if file.metadata().map_err(|_| IO)?.len() > MAX_STORE as u64 {
        return Err(LIMIT.into());
    }
    let mut bytes = Vec::new();
    file.take(MAX_STORE as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| IO)?;
    if bytes.len() > MAX_STORE {
        return Err(LIMIT.into());
    }
    let parsed = crate::strict_json::parse(&bytes).map_err(|_| CORRUPT)?;
    let store: Store = serde_json::from_value(parsed).map_err(|_| CORRUPT)?;
    if store.schema_version != "blocky.evaluation-store/v1" || store.assets.len() > MAX_ENTRIES {
        return Err(CORRUPT.into());
    }
    for (identity, asset) in &store.assets {
        if !kind(&asset.kind)
            || !key(&asset.key)
            || asset.revision == 0
            || asset.revision > MAX_REVISION
            || identity != &asset_key(&asset.kind, &asset.key)
            || validate_value(&asset.kind, &asset.value).is_err()
        {
            return Err(CORRUPT.into());
        }
    }
    Ok(store)
}
fn save(path: &Path, store: &Store) -> Result<(), String> {
    let bytes = serde_json::to_vec(store).map_err(|_| INVALID)?;
    if bytes.len() > MAX_STORE {
        return Err(LIMIT.into());
    }
    if path.exists() {
        regular(path)?;
        checked_file(&file_options().open(path).map_err(|_| IO)?)?;
    }
    let parent = path.parent().ok_or(IO)?;
    regular(parent)?;
    let mut temporary = tempfile::NamedTempFile::new_in(parent).map_err(|_| IO)?;
    temporary
        .write_all(&bytes)
        .and_then(|_| temporary.as_file().sync_all())
        .map_err(|_| IO)?;
    // Atomic same-directory replace. The previous ledger survives a write/rename error.
    temporary.persist(path).map_err(|_| IO)?;
    Ok(())
}
pub fn manage(root: &Path, request: &Request) -> Result<Value, String> {
    request.validate()?;
    let path = scope(root, &request.project_id)?;
    let lock_path = path.join("assets.lock");
    if lock_path.exists() {
        regular(&lock_path)?;
    }
    let mut options = file_options();
    options.write(true).create(true).truncate(false);
    let lock = options.open(&lock_path).map_err(|_| IO)?;
    checked_file(&lock)?;
    regular(&lock_path)?;
    lock.try_lock().map_err(|_| "BLK-EVAL-HOST-BUSY")?;
    let file = path.join("assets.json");
    let mut store = load(&file)?;
    if request.action == "list" {
        return Ok(
            json!({"assets":store.assets.values().filter(|a|a.kind==request.kind).map(|a|json!({"kind":a.kind,"key":a.key,"revision":a.revision})).collect::<Vec<_>>()}),
        );
    }
    let key = request.key.as_ref().ok_or(INVALID)?;
    let identity = asset_key(&request.kind, key);
    let current = store.assets.get(&identity);
    if request.action == "read" {
        return current
            .map(|a| serde_json::to_value(a).map_err(|_| IO.into()))
            .unwrap_or(Ok(Value::Null));
    }
    if current.map(|a| a.revision) != request.expected_revision.ok_or(INVALID)? {
        return Err(CONFLICT.into());
    }
    if current.is_some_and(|a| {
        (a.kind == "dataset" && a.value["status"] == "frozen")
            || (a.kind == "report" && a.value["status"] == "completed")
    }) {
        return Err(IMMUTABLE.into());
    }
    if current.is_none() && store.assets.len() >= MAX_ENTRIES {
        return Err(LIMIT.into());
    }
    let revision = current
        .map_or(0, |a| a.revision)
        .checked_add(1)
        .filter(|n| *n <= MAX_REVISION)
        .ok_or(CONFLICT)?;
    let asset = Asset {
        kind: request.kind.clone(),
        key: key.clone(),
        revision,
        value: request.value.clone().ok_or(INVALID)?,
    };
    let result = serde_json::to_value(&asset).map_err(|_| INVALID)?;
    store.assets.insert(identity, asset);
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
    fn binding() -> Value {
        json!({"configurationHash":"0".repeat(64),"model":{"resourceId":"model-one","provider":"local","modelId":"test","version":"one"}})
    }
    fn value(asset_kind: &str) -> Value {
        if asset_kind == "dataset" {
            return json!({"schemaVersion":"blocky.evaluation-dataset/v1","datasetId":"dataset-one","version":1,"name":"public dataset","createdAt":1,"status":"draft","binding":binding(),"cases":[{"caseId":"case-one","input":{"public":"example"}}]});
        }
        let mut v = json!({"schemaVersion":format!("blocky.evaluation-{asset_kind}/v1"),"checkpointId":"checkpoint-one","reportId":"report-one","datasetId":"dataset-one","datasetVersion":1,"datasetContentHash":"0".repeat(64),"binding":binding(),"candidate":{"id":"candidate-one","version":"one","contentHash":"0".repeat(64)},"resultDetailPolicy":"summary","createdAt":1,"updatedAt":1});
        if asset_kind == "report" {
            v["status"] = json!("partial");
            v["rows"] = json!([]);
            v["metrics"] = json!({});
            v["scoring"] = json!({});
        } else {
            v["status"] = json!("running");
            v["cases"] = json!([{"caseId":"case-one","status":"pending"}]);
            v["modelScoring"] = json!({"status":"not-run","rows":[]});
        }
        v
    }
    fn request(asset_kind: &str, key: &str, expected: Option<u64>) -> Request {
        serde_json::from_value(json!({"schemaVersion":"blocky.evaluation-asset-request/v1","requestId":"request-one","projectId":"project-one","sessionId":"run-one","action":"cas","kind":asset_kind,"key":key,"expectedRevision":expected,"value":value(asset_kind)})).unwrap()
    }
    fn read(mut r: Request) -> Request {
        r.action = "read".into();
        r.expected_revision = None;
        r.value = None;
        r
    }
    #[test]
    fn cas_reload_opaque_key_and_project_scope() {
        let temp = fixture();
        let root = temp.path().join("evaluation");
        let r = request("dataset", "../opaque/键:two", None);
        let one = manage(&root, &r).unwrap();
        assert_eq!(one["revision"], 1);
        assert_eq!(manage(&root, &read(r.clone())).unwrap(), one);
        let mut next = r.clone();
        next.expected_revision = Some(Some(1));
        assert_eq!(manage(&root, &next).unwrap()["revision"], 2);
        assert_eq!(manage(&root, &r).unwrap_err(), CONFLICT);
        let mut other = read(r);
        other.project_id = "other-project".into();
        assert!(manage(&root, &other).unwrap().is_null());
    }
    #[test]
    fn frozen_and_completed_are_immutable_checkpoint_is_mutable() {
        let temp = fixture();
        for asset_kind in ["dataset", "report", "checkpoint"] {
            let mut r = request(asset_kind, "one", None);
            if asset_kind == "dataset" {
                let v = r.value.as_mut().unwrap();
                v["status"] = json!("frozen");
                v["frozenAt"] = json!(1);
                v["contentHash"] = json!("0".repeat(64));
                v["bindingHash"] = json!("0".repeat(64));
            } else if asset_kind == "report" {
                let v = r.value.as_mut().unwrap();
                v["status"] = json!("completed");
                v["completedAt"] = json!(1);
            }
            manage(temp.path(), &r).unwrap();
            r.expected_revision = Some(Some(1));
            if asset_kind == "checkpoint" {
                assert_eq!(manage(temp.path(), &r).unwrap()["revision"], 2);
            } else {
                assert_eq!(manage(temp.path(), &r).unwrap_err(), IMMUTABLE);
            }
        }
    }
    #[test]
    fn list_only_metadata_and_invalid_schema_size_are_rejected() {
        let temp = fixture();
        let r = request("dataset", "opaque", None);
        manage(temp.path(), &r).unwrap();
        let mut list = read(r.clone());
        list.action = "list".into();
        list.key = None;
        let output = manage(temp.path(), &list).unwrap();
        assert_eq!(
            output,
            json!({"assets":[{"kind":"dataset","key":"opaque","revision":1}]})
        );
        let mut bad = r.clone();
        bad.value.as_mut().unwrap()["schemaVersion"] = json!("blocky.evaluation-report/v1");
        assert_eq!(bad.validate().unwrap_err(), INVALID);
        bad = r.clone();
        bad.value.as_mut().unwrap()["cases"][0]["input"] = json!("x".repeat(MAX_ASSET));
        assert_eq!(bad.validate().unwrap_err(), LIMIT);
        bad = r;
        bad.expected_revision = None;
        assert_eq!(bad.validate().unwrap_err(), INVALID);
    }
    #[test]
    fn corrupt_ledger_and_hardlink_fail_closed() {
        let temp = fixture();
        let r = request("dataset", "one", None);
        manage(temp.path(), &r).unwrap();
        let file = scope(temp.path(), "project-one")
            .unwrap()
            .join("assets.json");
        let previous = fs::read(&file).unwrap();
        fs::write(&file, b"broken ledger").unwrap();
        assert_eq!(manage(temp.path(), &read(r.clone())).unwrap_err(), CORRUPT);
        assert_eq!(fs::read(&file).unwrap(), b"broken ledger");
        fs::write(&file, &previous).unwrap();
        let linked = temp.path().join("linked.json");
        fs::hard_link(&file, &linked).unwrap();
        assert_eq!(manage(temp.path(), &read(r)).unwrap_err(), PERMISSION);
    }
    #[test]
    fn competing_cas_writers_have_one_winner() {
        let temp = fixture();
        let r = request("checkpoint", "one", None);
        manage(temp.path(), &r).unwrap();
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(3));
        let mut threads = Vec::new();
        for _ in 0..2 {
            let root = temp.path().to_path_buf();
            let mut next = r.clone();
            next.expected_revision = Some(Some(1));
            let barrier = barrier.clone();
            threads.push(std::thread::spawn(move || {
                barrier.wait();
                for _ in 0..200 {
                    match manage(&root, &next) {
                        Err(code) if code == "BLK-EVAL-HOST-BUSY" => {
                            std::thread::sleep(std::time::Duration::from_millis(2));
                        }
                        value => return value,
                    }
                }
                panic!("bounded CAS retry exhausted")
            }));
        }
        barrier.wait();
        let outcomes: Vec<_> = threads.into_iter().map(|t| t.join().unwrap()).collect();
        assert_eq!(outcomes.iter().filter(|v| v.is_ok()).count(), 1);
        assert_eq!(
            outcomes
                .iter()
                .filter(|v| v.as_ref().err().is_some_and(|e| e == CONFLICT))
                .count(),
            1
        );
        assert_eq!(manage(temp.path(), &read(r)).unwrap()["revision"], 2);
    }
    #[cfg(windows)]
    #[test]
    fn failed_atomic_replace_preserves_previous_ledger() {
        use std::os::windows::fs::OpenOptionsExt;
        let temp = fixture();
        let mut r = request("checkpoint", "one", None);
        manage(temp.path(), &r).unwrap();
        let folder = scope(temp.path(), "project-one").unwrap();
        let file = folder.join("assets.json");
        let previous = fs::read(&file).unwrap();
        let held = fs::OpenOptions::new()
            .read(true)
            .share_mode(
                windows_sys::Win32::Storage::FileSystem::FILE_SHARE_READ
                    | windows_sys::Win32::Storage::FileSystem::FILE_SHARE_WRITE,
            )
            .open(&file)
            .unwrap();
        r.expected_revision = Some(Some(1));
        assert_eq!(manage(temp.path(), &r).unwrap_err(), IO);
        assert_eq!(fs::read(&file).unwrap(), previous);
        drop(held);
        assert_eq!(manage(temp.path(), &read(r)).unwrap()["revision"], 1);
        assert_eq!(fs::read_dir(folder).unwrap().count(), 2);
    }
}
