//! Project memory and one registered pure tool. No client-controlled filesystem paths.
mod memory_store;
pub use memory_store::ManageRequest;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    io::Write,
    path::PathBuf,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
const INVALID: &str = "BLK-AGENT-INVALID";
const PERMISSION: &str = "BLK-PERM-001";
fn stable(s: &str) -> bool {
    s.len() <= 128 && crate::project_store::stable(s)
}
pub fn validate_context(project: &str, session: &str) -> Result<(), String> {
    if !stable(project) || !stable(session) {
        Err(INVALID.into())
    } else {
        Ok(())
    }
}
pub fn digest(value: &impl Serialize) -> Result<String, String> {
    Ok(format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(value).map_err(|_| INVALID)?)
    ))
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MemoryRequest {
    pub request_id: String,
    pub project_id: String,
    pub session_id: String,
    pub scope: String,
    pub key: String,
    pub action: String,
    #[serde(
        default,
        deserialize_with = "present_value",
        skip_serializing_if = "Option::is_none"
    )]
    pub value: Option<Value>,
}
fn present_value<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<Value>, D::Error> {
    Value::deserialize(deserializer).map(Some)
}
impl MemoryRequest {
    pub fn validate(&self) -> Result<(), String> {
        if !stable(&self.request_id)
            || !stable(&self.project_id)
            || !stable(&self.session_id)
            || !stable(&self.key)
            || self.scope != "project"
            || !["read", "write", "delete"].contains(&self.action.as_str())
            || (self.action == "write") != self.value.is_some()
        {
            return Err(INVALID.into());
        }
        if self
            .value
            .as_ref()
            .is_some_and(|v| serde_json::to_vec(v).map_or(true, |b| b.len() > 32768))
        {
            return Err("BLK-AGENT-LIMIT".into());
        }
        Ok(())
    }
    pub fn preflight(&self) -> Result<Value, String> {
        self.validate()?;
        Ok(
            json!({"requestDigest":digest(self)?,"projectId":self.project_id,"sessionId":self.session_id,"scope":self.scope,"key":self.key,"action":self.action,"valueBytes":self.value.as_ref().map(|v|serde_json::to_vec(v).unwrap_or_default().len()).unwrap_or(0)}),
        )
    }
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ToolRequest {
    pub schema_version: String,
    pub project_id: String,
    pub run_id: String,
    pub request_id: String,
    pub tool_id: String,
    pub input: String,
}
impl ToolRequest {
    pub fn validate(&self) -> Result<(), String> {
        if self.schema_version != "blocky.tool-request/v1"
            || !stable(&self.project_id)
            || !stable(&self.run_id)
            || !stable(&self.request_id)
            || self.tool_id != "text.analyze/v1"
            || self.input.len() > 16384
        {
            Err(INVALID.into())
        } else {
            Ok(())
        }
    }
    pub fn preflight(&self) -> Result<Value, String> {
        self.validate()?;
        Ok(
            json!({"requestDigest":digest(self)?,"projectId":self.project_id,"runId":self.run_id,"requestId":self.request_id,"toolId":self.tool_id,"inputBytes":self.input.len()}),
        )
    }
}
struct Grant {
    project: String,
    session: String,
    created: Instant,
    lifetime: Duration,
}
#[derive(Default)]
struct State {
    grants: HashMap<String, Grant>,
    used_tools: HashSet<String>,
    closed: bool,
}
#[derive(Clone)]
pub struct AgentData {
    root: PathBuf,
    state: Arc<Mutex<State>>,
}
impl AgentData {
    pub fn new(root: PathBuf) -> Self {
        Self {
            root,
            state: Arc::new(Mutex::new(State::default())),
        }
    }
    /// Called only after the native consent surface, never registered as direct IPC.
    pub fn authorize(&self, project: &str, session: &str) -> Result<String, String> {
        if !stable(project) || !stable(session) {
            return Err(INVALID.into());
        }
        let mut state = self.state.lock().map_err(|_| INVALID)?;
        state
            .grants
            .retain(|_, g| g.created.elapsed() < g.lifetime);
        if state.closed || state.grants.len() >= 128 {
            return Err(PERMISSION.into());
        }
        let token = uuid::Uuid::new_v4().to_string();
        state.grants.insert(
            token.clone(),
            Grant {
                project: project.into(),
                session: session.into(),
                created: Instant::now(),
                lifetime: Duration::from_secs(1800),
            },
        );
        Ok(token)
    }
    pub fn revoke(&self, token: &str) -> Result<(), String> {
        self.state.lock().map_err(|_| INVALID)?.grants.remove(token);
        Ok(())
    }
    pub fn memory(&self, token: &str, request: &MemoryRequest) -> Result<Value, String> {
        request.validate()?;
        let state = self.state.lock().map_err(|_| INVALID)?;
        let grant = state
            .grants
            .get(token)
            .filter(|g| {
                !state.closed
                    && g.project == request.project_id
                    && g.session == request.session_id
                    && g.created.elapsed() < g.lifetime
            })
            .ok_or(PERMISSION)?;
        let _ = grant;
        // The grant and cancellation lock remains held across atomic commit.
        self.memory_inner(request)
    }
    fn memory_inner(&self, r: &MemoryRequest) -> Result<Value, String> {
        memory_store::legacy(&self.root, r)
    }
    pub fn manage_memory(&self, token: &str, r: &ManageRequest) -> Result<Value, String> {
        r.validate()?;
        let state = self.state.lock().map_err(|_| INVALID)?;
        state.grants.get(token).filter(|g| !state.closed && g.project == r.project_id
            && g.session == r.session_id && g.created.elapsed() < g.lifetime).ok_or(PERMISSION)?;
        memory_store::manage(&self.root, r)
    }
    pub fn tool(&self, r: &ToolRequest, approved_digest: &str) -> Result<Value, String> {
        r.validate()?;
        if digest(r)? != approved_digest {
            return Err(PERMISSION.into());
        }
        let mut state = self.state.lock().map_err(|_| INVALID)?;
        if state.closed
            || state.used_tools.len() >= 4096
            || !state.used_tools.insert(r.request_id.clone())
        {
            return Err(PERMISSION.into());
        }
        Ok(
            json!({"characters":r.input.chars().count(),"lines":if r.input.is_empty(){0}else{r.input.lines().count()},"words":r.input.split_whitespace().count()}),
        )
    }
    pub fn cancel_tool(&self, id: &str) -> Result<(), String> {
        if !stable(id) {
            return Err(INVALID.into());
        }
        let mut state = self.state.lock().map_err(|_| INVALID)?;
        if state.used_tools.len() >= 4096 {
            return Err("BLK-AGENT-LIMIT".into());
        }
        state.used_tools.insert(id.into());
        Ok(())
    }
    pub fn shutdown(&self) -> Result<(), String> {
        let mut state = self.state.lock().map_err(|_| INVALID)?;
        state.closed = true;
        state.grants.clear();
        Ok(())
    }
}
pub fn dispatch(root: PathBuf, v: &Value) -> Result<Value, String> {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct Envelope {
        schema_version: String,
        operation: String,
        request: Value,
        approval: Option<Approval>,
    }
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct Approval {
        approved: bool,
        request_digest: String,
    }
    let e: Envelope = serde_json::from_value(v.clone()).map_err(|_| INVALID)?;
    if e.schema_version != "blocky.project-io/v1alpha1" {
        return Err(INVALID.into());
    }
    let approvals = root.join("approvals");
    let host = AgentData::new(root);
    match e.operation.as_str() {
        "agent-memory-manage-preflight" | "agent-memory-manage" => {
            let r: ManageRequest = serde_json::from_value(e.request).map_err(|_| INVALID)?;
            if e.operation.ends_with("preflight") {
                if e.approval.is_some() { return Err(INVALID.into()); }
                let mut preview=r.preflight()?;
                preview["approvalExpiresAt"]=crate::approval_ledger::issue(&approvals,
                    &format!("memory/{}/{}",r.project_id,r.request_id),&digest(&r)?)?.into();
                return Ok(preview);
            }
            r.validate()?;
            let a=e.approval.filter(|a|a.approved).ok_or(PERMISSION)?;
            if a.request_digest != digest(&r)? { return Err(PERMISSION.into()); }
            crate::approval_ledger::consume(&approvals,&format!("memory/{}/{}",r.project_id,r.request_id),&a.request_digest)?;
            let token=host.authorize(&r.project_id,&r.session_id)?;
            host.manage_memory(&token,&r)
        }

        "agent-memory-preflight" | "agent-memory" => {
            let r: MemoryRequest = serde_json::from_value(e.request).map_err(|_| INVALID)?;
            if e.operation.ends_with("preflight") {
                if e.approval.is_some() {
                    return Err(INVALID.into());
                }
                let mut preview = r.preflight()?;
                let expires = crate::approval_ledger::issue(
                    &approvals,
                    &format!("memory/{}/{}", r.project_id, r.request_id),
                    &digest(&r)?,
                )?;
                preview["approvalExpiresAt"] = expires.into();
                return Ok(preview);
            }
            r.validate()?;
            let a = e.approval.filter(|a| a.approved).ok_or(PERMISSION)?;
            if a.request_digest != digest(&r)? {
                return Err(PERMISSION.into());
            }
            crate::approval_ledger::consume(
                &approvals,
                &format!("memory/{}/{}", r.project_id, r.request_id),
                &a.request_digest,
            )?;
            let token = host.authorize(&r.project_id, &r.session_id)?;
            host.memory(&token, &r)
        }
        "agent-tool-preflight" | "agent-tool" => {
            let r: ToolRequest = serde_json::from_value(e.request).map_err(|_| INVALID)?;
            if e.operation.ends_with("preflight") {
                if e.approval.is_some() {
                    return Err(INVALID.into());
                }
                let mut preview = r.preflight()?;
                let expires = crate::approval_ledger::issue(
                    &approvals,
                    &format!("tool/{}/{}", r.project_id, r.request_id),
                    &digest(&r)?,
                )?;
                preview["approvalExpiresAt"] = expires.into();
                return Ok(preview);
            }
            let a = e.approval.filter(|a| a.approved).ok_or(PERMISSION)?;
            r.validate()?;
            if a.request_digest != digest(&r)? {
                return Err(PERMISSION.into());
            }
            crate::approval_ledger::consume(
                &approvals,
                &format!("tool/{}/{}", r.project_id, r.request_id),
                &a.request_digest,
            )?;
            host.tool(&r, &a.request_digest)
        }
        _ => Err(INVALID.into()),
    }
}
#[cfg(test)]
mod tests;
