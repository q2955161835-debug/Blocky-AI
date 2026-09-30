//! Receipts contain references, hashes and stable outcomes only. A disconnected
//! call is never inferred to be unapplied, and a consumed request is never replayed.
use super::ToolRequest;
use serde_json::{json, Value};
use std::{
    fs::{File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
const ERROR: &str = "BLK-TOOL-RECEIPT";
fn root(profile: &Path) -> Result<PathBuf, String> {
    let path = profile.join("tool-runs");
    std::fs::create_dir_all(&path).map_err(|_| ERROR)?;
    crate::knowledge::no_links(&path).map_err(|_| ERROR)?;
    Ok(path)
}
fn key(project: &str, request: &str) -> Result<String, String> {
    if !super::protocol::stable(project) || !super::protocol::stable(request) {
        return Err(ERROR.into());
    }
    crate::agent_data::digest(&json!([project, request]))
}
fn global(path: &Path) -> Result<File, String> {
    let lock = path.join("ledger.lock");
    if lock.exists() {
        crate::knowledge::no_links(&lock).map_err(|_| ERROR)?;
    }
    let file = OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(lock)
        .map_err(|_| ERROR)?;
    file.try_lock().map_err(|_| "BLK-TOOL-BUSY")?;
    Ok(file)
}
fn read(path: &Path) -> Result<Value, String> {
    crate::knowledge::no_links(path).map_err(|_| ERROR)?;
    let mut bytes = Vec::new();
    File::open(path)
        .map_err(|_| ERROR)?
        .take(8193)
        .read_to_end(&mut bytes)
        .map_err(|_| ERROR)?;
    if bytes.len() > 8192 {
        return Err(ERROR.into());
    }
    let value = crate::strict_json::parse(&bytes).map_err(|_| ERROR)?;
    if value["schemaVersion"] != "blocky.tool-receipt/v1"
        || ![
            "running",
            "completed",
            "failed",
            "unknown",
            "confirmed-completed",
            "confirmed-not-applied",
        ]
        .contains(&value["status"].as_str().unwrap_or(""))
        || ["projectId", "requestId", "resourceId"].iter().any(|key| {
            value[*key]
                .as_str()
                .is_none_or(|s| !super::protocol::stable(s))
        })
    {
        return Err(ERROR.into());
    }
    if value.as_object().is_none_or(|v| {
        v.keys().any(|s| {
            ![
                "schemaVersion",
                "projectId",
                "runId",
                "requestId",
                "resourceId",
                "action",
                "requestDigest",
                "status",
                "startedAt",
                "code",
            ]
            .contains(&s.as_str())
        })
    }) || value["runId"]
        .as_str()
        .is_none_or(|s| !super::protocol::stable(s))
        || !["call", "discover", "read-resource"].contains(&value["action"].as_str().unwrap_or(""))
        || value["startedAt"].as_u64().is_none()
        || value["requestDigest"]
            .as_str()
            .is_none_or(|s| s.len() != 64 || !s.bytes().all(|c| c.is_ascii_hexdigit()))
        || value.get("code").is_some_and(|v| {
            v.as_str().is_none_or(|s| {
                s.len() > 96
                    || !s.starts_with("BLK-")
                    || !s
                        .bytes()
                        .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == b'-')
            })
        })
    {
        return Err(ERROR.into());
    }
    let expected = key(
        value["projectId"].as_str().ok_or(ERROR)?,
        value["requestId"].as_str().ok_or(ERROR)?,
    )?;
    if path.file_stem().and_then(|s| s.to_str()) != Some(expected.as_str()) {
        return Err(ERROR.into());
    }
    Ok(value)
}
fn write(root: &Path, path: &Path, value: &Value) -> Result<(), String> {
    let mut file = tempfile::NamedTempFile::new_in(root).map_err(|_| ERROR)?;
    file.write_all(&serde_json::to_vec(value).map_err(|_| ERROR)?)
        .and_then(|_| file.as_file().sync_all())
        .map_err(|_| ERROR)?;
    file.persist(path).map_err(|_| ERROR)?;
    Ok(())
}
fn current(root: &Path, path: &Path) -> Result<Value, String> {
    let mut value = read(path)?;
    if value["status"] == "running" {
        let lock_path = root.join(format!(
            "{}.lock",
            key(
                value["projectId"].as_str().ok_or(ERROR)?,
                value["requestId"].as_str().ok_or(ERROR)?
            )?
        ));
        crate::knowledge::no_links(&lock_path).map_err(|_| ERROR)?;
        let lock = OpenOptions::new()
            .read(true)
            .write(true)
            .open(lock_path)
            .map_err(|_| ERROR)?;
        if lock.try_lock().is_ok() {
            value["status"] = "unknown".into();
            value["code"] = "BLK-TOOL-INTERRUPTED".into();
        }
    }
    Ok(value)
}
pub(crate) fn list(
    profile: &Path,
    project: &str,
    resource: Option<&str>,
) -> Result<Vec<Value>, String> {
    if !super::protocol::stable(project) {
        return Err(ERROR.into());
    }
    let root = root(profile)?;
    let _guard = global(&root)?;
    list_in(&root, project, resource)
}
fn list_in(root: &Path, project: &str, resource: Option<&str>) -> Result<Vec<Value>, String> {
    let mut result = Vec::new();
    let mut count = 0;
    for entry in std::fs::read_dir(&root).map_err(|_| ERROR)? {
        let path = entry.map_err(|_| ERROR)?.path();
        if path.extension().is_none_or(|s| s != "json") {
            continue;
        }
        count += 1;
        if count > 4096 {
            return Err("BLK-TOOL-LIMIT".into());
        }
        let value = current(&root, &path)?;
        if value["projectId"] == project && resource.is_none_or(|id| value["resourceId"] == id) {
            result.push(value);
        }
    }
    result.sort_by_key(|v| v["startedAt"].as_u64().unwrap_or(0));
    result.reverse();
    Ok(result)
}
pub(crate) struct Receipt {
    root: PathBuf,
    path: PathBuf,
    value: Value,
    _active: File,
    finished: bool,
}
impl Receipt {
    pub(crate) fn begin(profile: &Path, r: &ToolRequest, digest: &str) -> Result<Self, String> {
        let root = root(profile)?;
        let _global = global(&root)?;
        let unresolved = list_in(&root, &r.project_id, Some(&r.resource_id))?;
        if unresolved.iter().any(|v| v["status"] == "unknown") {
            return Err("BLK-TOOL-RECOVERY-REQUIRED".into());
        }
        if unresolved.iter().any(|v| v["status"] == "running") {
            return Err("BLK-TOOL-BUSY".into());
        }
        let id = key(&r.project_id, &r.request_id)?;
        let path = root.join(format!("{id}.json"));
        if path.exists() {
            return Err("BLK-TOOL-REPLAY".into());
        }
        if std::fs::read_dir(&root)
            .map_err(|_| ERROR)?
            .filter_map(Result::ok)
            .filter(|e| e.path().extension().is_some_and(|s| s == "json"))
            .count()
            >= 4096
        {
            return Err("BLK-TOOL-LIMIT".into());
        }
        let active = OpenOptions::new()
            .create_new(true)
            .read(true)
            .write(true)
            .open(root.join(format!("{id}.lock")))
            .map_err(|_| "BLK-TOOL-REPLAY")?;
        active.try_lock().map_err(|_| "BLK-TOOL-BUSY")?;
        let value = json!({"schemaVersion":"blocky.tool-receipt/v1","projectId":r.project_id,"runId":r.run_id,"requestId":r.request_id,"resourceId":r.resource_id,"action":r.action,"requestDigest":digest,"status":"running","startedAt":SystemTime::now().duration_since(UNIX_EPOCH).map_err(|_|ERROR)?.as_secs()});
        write(&root, &path, &value)?;
        Ok(Self {
            root,
            path,
            value,
            _active: active,
            finished: false,
        })
    }
    pub(crate) fn finish(&mut self, result: &Result<Value, String>) -> Result<(), String> {
        let _guard = global(&self.root)?;
        self.value["status"] = if result.is_ok() {
            "completed"
        } else if self.value["action"] == "call" {
            "unknown"
        } else {
            "failed"
        }
        .into();
        if let Err(code) = result {
            self.value["code"] = code.clone().into();
        }
        write(&self.root, &self.path, &self.value)?;
        self.finished = true;
        Ok(())
    }
}
impl Drop for Receipt {
    fn drop(&mut self) {
        if !self.finished {
            self.value["status"] = "unknown".into();
            self.value["code"] = "BLK-TOOL-INTERRUPTED".into();
            if let Ok(_guard) = global(&self.root) {
                let _ = write(&self.root, &self.path, &self.value);
            }
        }
    }
}
pub(crate) fn reconcile_preview(
    profile: &Path,
    project: &str,
    request: &str,
    outcome: &str,
) -> Result<Value, String> {
    if !["confirmed-completed", "confirmed-not-applied"].contains(&outcome) {
        return Err(ERROR.into());
    }
    let root = root(profile)?;
    let _guard = global(&root)?;
    let value = current(
        &root,
        &root.join(format!("{}.json", key(project, request)?)),
    )?;
    if value["status"] != "unknown" {
        return Err("BLK-TOOL-RECOVERY-STATE".into());
    }
    let digest = crate::agent_data::digest(&json!({"receipt":value,"outcome":outcome}))?;
    Ok(json!({"projectId":project,"requestId":request,"outcome":outcome,"requestDigest":digest}))
}
pub(crate) fn reconcile(
    profile: &Path,
    project: &str,
    request: &str,
    outcome: &str,
    digest: &str,
) -> Result<Value, String> {
    if reconcile_preview(profile, project, request, outcome)?["requestDigest"] != digest {
        return Err("BLK-PERM-001".into());
    }
    let root = root(profile)?;
    let _guard = global(&root)?;
    let path = root.join(format!("{}.json", key(project, request)?));
    let mut value = current(&root, &path)?;
    if value["status"] != "unknown" {
        return Err("BLK-TOOL-RECOVERY-STATE".into());
    }
    let now_digest = crate::agent_data::digest(&json!({"receipt":value,"outcome":outcome}))?;
    if now_digest != digest {
        return Err("BLK-PERM-001".into());
    }
    value["status"] = outcome.into();
    write(&root, &path, &value)?;
    Ok(value)
}
