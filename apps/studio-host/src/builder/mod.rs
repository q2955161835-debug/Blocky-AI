pub(crate) mod evidence;
mod input_guard;
pub(crate) use input_guard::credentials as contains_credentials;
mod process;
#[cfg(test)]
mod tests;
use crate::provider::builder_model::BuilderModel;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};
const INVALID: &str = "BLK-BUILDER-001";
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConversationMessage {
    pub role: String,
    pub text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BuilderRequest {
    pub schema_version: String,
    pub request_id: String,
    pub project_id: String,
    pub intent: String,
    pub prompt: String,
    pub module_id: String,
    pub selection: Vec<String>,
    pub create_surface: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub conversation: Vec<ConversationMessage>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BuilderStart {
    pub request: BuilderRequest,
    pub original_json: String,
    pub mode: String,
    pub resource_id: Option<String>,
    pub max_turns: u32,
}
impl BuilderStart {
    pub fn validate(&self) -> Result<Value, String> {
        let r = &self.request;
        if r.schema_version != "blocky.builder-request/v1"
            || !["build", "explain", "repair"].contains(&r.intent.as_str())
            || !["deterministic", "live"].contains(&self.mode.as_str())
            || !(1..=4).contains(&self.max_turns)
            || [&r.request_id, &r.project_id, &r.module_id]
                .iter()
                .any(|s| s.len() > 128 || !crate::project_store::stable(s))
            || r.prompt.trim().is_empty()
            || r.prompt.chars().count() > 16000
            || r.selection.len() > 100
            || r.selection
                .iter()
                .any(|s| s.len() > 200 || !crate::project_store::stable(s))
            || r.selection.iter().collect::<HashSet<_>>().len() != r.selection.len()
            || self.original_json.len() > 8 * 1024 * 1024
            || (r.create_surface && r.intent != "build")
            || r.conversation.len() > 20
            || r.conversation
                .iter()
                .map(|m| m.text.chars().count())
                .sum::<usize>()
                > 32000
            || r.conversation.iter().any(|m| {
                !["user", "assistant"].contains(&m.role.as_str())
                    || m.text.trim().is_empty()
                    || m.text.chars().count() > 4000
                    || m.status.as_deref().is_some_and(|s| {
                        ![
                            "proposed",
                            "accepted",
                            "rejected",
                            "explained",
                            "failed",
                            "cancelled",
                            "stale",
                        ]
                        .contains(&s)
                    })
            })
        {
            return Err(INVALID.into());
        }
        let p = crate::strict_json::parse(self.original_json.as_bytes()).map_err(|_| INVALID)?;
        if input_guard::credentials(&Value::String(r.prompt.clone()))
            || input_guard::credentials(
                &serde_json::to_value(&r.conversation).map_err(|_| INVALID)?,
            )
            || input_guard::credentials(&p)
        {
            return Err(INVALID.into());
        }
        crate::patch_guard::project_files(&p)?;
        if p["manifest"]["projectId"] != r.project_id
            || p["manifest"]["modules"]
                .as_array()
                .is_none_or(|a| !a.iter().any(|m| m["moduleId"] == r.module_id))
        {
            return Err("BLK-BUILDER-002".into());
        }
        Ok(p)
    }
    pub fn digest(&self) -> Result<String, String> {
        self.validate()?;
        Ok(format!(
            "{:x}",
            Sha256::digest(serde_json::to_vec(self).map_err(|_| INVALID)?)
        ))
    }
}
#[derive(Default)]
struct State {
    active: HashMap<String, Arc<AtomicBool>>,
    used: HashSet<String>,
    closing: bool,
}
#[derive(Clone, Default)]
pub struct BuilderHost {
    state: Arc<Mutex<State>>,
}
fn registry(root: &Path) -> Result<Value, String> {
    Ok(crate::user_store::UserStore::new(root.join("user"))
        .read("resources", "app")?
        .unwrap_or(json!({"resources":[]})))
}
fn binding(root: &Path, start: &BuilderStart) -> Result<Option<BuilderModel>, String> {
    if start.mode == "deterministic" {
        return Ok(None);
    }
    let resources = registry(root)?;
    let r = resources["resources"]
        .as_array()
        .and_then(|a| {
            a.iter().find(|r| {
                Some(r["resourceId"].as_str().unwrap_or("")) == start.resource_id.as_deref()
            })
        })
        .ok_or("BLK-PROVIDER-CONFIG")?;
    if !["deepseek", "xirang"].contains(&r["definition"]["provider"].as_str().unwrap_or("")) {
        return Ok(Some(BuilderModel::gateway(
            root,
            &start.request.request_id,
            &start.request.project_id,
            r["resourceId"].as_str().ok_or("BLK-PROVIDER-CONFIG")?,
            &start.request.intent,
        )?));
    }
    let secret_ref = r["secretBindings"]
        .as_array()
        .and_then(|a| a.iter().find(|v| v["fieldId"] == "apiKey"))
        .map(|v| v["secretRef"].clone())
        .ok_or("BLK-PROVIDER-CONFIG")?;
    let request:crate::provider::ProviderRequest=serde_json::from_value(json!({"schemaVersion":"blocky.provider-request/v1","requestId":start.request.request_id,"projectId":start.request.project_id,"resourceId":r["resourceId"],"secretRef":secret_ref,"provider":r["definition"]["provider"],"modelId":r["definition"]["modelId"],"messages":[{"role":"user","content":"Blocky 构建会话"}],"maxOutputTokens":1024,"timeoutMs":60000})).map_err(|_|"BLK-PROVIDER-CONFIG")?;
    crate::provider::ProviderHost::default().preflight(root, &request)?;
    Ok(Some(BuilderModel::Legacy(request)))
}
fn approval_digest(start: &BuilderStart, binding: Option<&BuilderModel>) -> Result<String, String> {
    let request = start.digest()?;
    match binding {
        None => Ok(request),
        Some(b) => Ok(format!(
            "{:x}",
            Sha256::digest(format!("{request}:{}", b.digest()?))
        )),
    }
}
impl BuilderHost {
    pub fn destination(
        &self,
        root: &Path,
        start: &BuilderStart,
        digest: &str,
    ) -> Result<String, String> {
        let model = binding(root, start)?;
        if approval_digest(start, model.as_ref())? != digest {
            return Err("BLK-PERM-001".into());
        }
        model.ok_or("BLK-PROVIDER-CONFIG")?.destination(root)
    }
    pub fn preflight(&self, root: &Path, start: &BuilderStart) -> Result<Value, String> {
        let project = start.validate()?;
        let b = binding(root, start)?;
        Ok(
            json!({"requestDigest":approval_digest(start,b.as_ref())?,"requestId":start.request.request_id,"projectId":start.request.project_id,"projectName":project["manifest"]["displayName"],"mode":start.mode,"provider":b.as_ref().map(|b|b.provider()),"endpoint":b.as_ref().map(|b|b.endpoint_label()),"modelId":b.as_ref().map(|b|b.model()),"maxTurns":start.max_turns,"maxOutputTokensPerTurn":1024,"createSurface":start.request.create_surface,"inputScope":"目标模块积木、目录、资源名称、选择、诊断和本机对话上下文；不发送秘密绑定或资源定义"}),
        )
    }
    pub fn run(&self, root: PathBuf, start: BuilderStart, digest: &str) -> Result<Value, String> {
        let b = binding(&root, &start)?;
        if approval_digest(&start, b.as_ref())? != digest {
            return Err("BLK-PERM-001".into());
        }
        let project = start.validate()?;
        let registry = registry(&root)?;
        if input_guard::credentials(&registry) {
            return Err(INVALID.into());
        }
        let cancel = Arc::new(AtomicBool::new(false));
        {
            let mut s = self.state.lock().map_err(|_| "BLK-BUILDER-STATE")?;
            if s.closing
                || !s.active.is_empty()
                || s.used.contains(&start.request.request_id)
                || s.used.len() >= 4096
            {
                return Err("BLK-BUILDER-STATE".into());
            }
            s.used.insert(start.request.request_id.clone());
            s.active
                .insert(start.request.request_id.clone(), cancel.clone());
        }
        let mut evidence = evidence::Evidence::new(&start);
        let result = evidence.save(&root).and_then(|_| {
            process::run(
                &root,
                &start,
                project,
                &registry,
                b.as_ref(),
                &cancel,
                &mut evidence,
            )
        });
        self.state
            .lock()
            .map_err(|_| "BLK-BUILDER-STATE")?
            .active
            .remove(&start.request.request_id);
        let result = (|| {
            if cancel.load(Ordering::SeqCst)
                && result
                    .as_ref()
                    .err()
                    .is_none_or(|code| code != "BLK-BUILDER-TIMEOUT")
            {
                return Err("BLK-BUILDER-CANCELLED".into());
            }
            let result = result?;
            validate_result(&start, &result, &registry)?;
            Ok(result)
        })();
        let end = evidence::now().max(
            evidence
                .attempts
                .last()
                .map(|a| a.completed_at_ms.unwrap_or(a.started_at_ms))
                .unwrap_or(evidence.started_at_ms),
        );
        evidence.completed_at_ms = Some(end);
        evidence.outcome = result
            .as_ref()
            .err()
            .cloned()
            .unwrap_or_else(|| "completed".into());
        for attempt in &mut evidence.attempts {
            if attempt.completed_at_ms.is_none() {
                attempt.completed_at_ms = Some(end);
                attempt.outcome = result
                    .as_ref()
                    .err()
                    .cloned()
                    .unwrap_or_else(|| "BLK-BUILDER-EVIDENCE".into());
            }
        }
        evidence.save(&root)?;
        result
    }
    pub fn cancel(&self, id: &str) -> Result<(), String> {
        if id.len() > 128 || !crate::project_store::stable(id) {
            return Err(INVALID.into());
        }
        let mut s = self.state.lock().map_err(|_| "BLK-BUILDER-STATE")?;
        if let Some(flag) = s.active.get(id) {
            flag.store(true, Ordering::SeqCst);
        } else if s.used.len() < 4096 {
            s.used.insert(id.to_owned());
        }
        Ok(())
    }
    pub fn shutdown(&self) -> Result<(), String> {
        {
            let mut s = self.state.lock().map_err(|_| "BLK-BUILDER-STATE")?;
            s.closing = true;
            for flag in s.active.values() {
                flag.store(true, Ordering::SeqCst);
            }
        }
        let start = Instant::now();
        while !self
            .state
            .lock()
            .map_err(|_| "BLK-BUILDER-STATE")?
            .active
            .is_empty()
        {
            if start.elapsed() > Duration::from_secs(3) {
                return Err("BLK-BUILDER-TIMEOUT".into());
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        Ok(())
    }
}
fn validate_result(start: &BuilderStart, result: &Value, registry: &Value) -> Result<(), String> {
    let expected = format!("{:x}", Sha256::digest(start.original_json.as_bytes()));
    if result["requestId"] != start.request.request_id
        || result["projectId"] != start.request.project_id
        || result["baseDigest"] != expected
    {
        return Err("BLK-BUILDER-002".into());
    }
    if start.request.intent == "explain" {
        if result.get("patch").is_some() {
            return Err("BLK-BUILDER-003".into());
        }
        return Ok(());
    }
    let patch = &result["patch"];
    for op in patch["operations"].as_array().ok_or(INVALID)? {
        if op["op"] == "app-surface.add" {
            if !start.request.create_surface
                || op["manifest"]["associatedModuleIds"] != json!([start.request.module_id])
            {
                return Err("BLK-BUILDER-003".into());
            }
        } else if op["moduleId"] != start.request.module_id {
            return Err("BLK-BUILDER-003".into());
        }
        if start.request.intent == "repair"
            && (op["op"] != "block.update"
                || (!start.request.selection.is_empty()
                    && !start
                        .request
                        .selection
                        .iter()
                        .any(|id| op["blockId"] == *id)))
        {
            return Err("BLK-BUILDER-003".into());
        }
    }
    let permissions = patch["permissionDelta"]
        .as_array()
        .ok_or(INVALID)?
        .iter()
        .map(|v| v.as_str().map(str::to_owned).ok_or(INVALID.to_owned()))
        .collect::<Result<Vec<_>, _>>()?;
    // Validation only: no project file is written and permissions are not granted.
    crate::patch_guard::validate_with_registry(
        &start.original_json,
        patch,
        &permissions,
        registry,
    )?;
    Ok(())
}
pub fn dispatch(root: PathBuf, value: &Value) -> Result<Value, String> {
    if value["operation"] == "builder-evidence" {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase", deny_unknown_fields)]
        struct Read {
            schema_version: String,
            operation: String,
            request_id: String,
        }
        let r: Read = serde_json::from_value(value.clone()).map_err(|_| INVALID)?;
        if r.schema_version != "blocky.project-io/v1alpha1" || r.operation != "builder-evidence" {
            return Err(INVALID.into());
        }
        return evidence::read(&root, &r.request_id);
    }
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct Envelope {
        schema_version: String,
        operation: String,
        start: BuilderStart,
        approval: Option<Approval>,
    }
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct Approval {
        approved: bool,
        request_digest: String,
    }
    let e: Envelope = serde_json::from_value(value.clone()).map_err(|_| INVALID)?;
    if e.schema_version != "blocky.project-io/v1alpha1" {
        return Err(INVALID.into());
    }
    let host = BuilderHost::default();
    let identity = format!(
        "builder/{}/{}",
        e.start.request.project_id, e.start.request.request_id
    );
    match e.operation.as_str() {
        "builder-preflight" if e.approval.is_none() => {
            let mut preview = host.preflight(&root, &e.start)?;
            if e.start.mode == "live" {
                preview["approvalExpiresAt"] = crate::approval_ledger::issue(
                    &root.join("approvals"),
                    &identity,
                    preview["requestDigest"].as_str().ok_or(INVALID)?,
                )?
                .into();
            }
            Ok(preview)
        }
        "builder-run" => {
            let digest = approval_digest(&e.start, binding(&root, &e.start)?.as_ref())?;
            if e.start.mode == "live" {
                let a = e
                    .approval
                    .filter(|a| a.approved && a.request_digest == digest)
                    .ok_or("BLK-PERM-001")?;
                crate::approval_ledger::consume(
                    &root.join("approvals"),
                    &identity,
                    &a.request_digest,
                )?;
            }
            host.run(root, e.start, &digest)
        }
        _ => Err(INVALID.into()),
    }
}
