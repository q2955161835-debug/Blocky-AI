mod cli;
mod files;
mod process;
mod session;
pub use session::{native_reply, session_main};
#[cfg(test)]
mod tests;
use crate::provider::builder_model::BuilderModel;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, Instant},
};
pub(crate) const TOOLS: [&str; 7] = [
    "workspace_list",
    "workspace_search",
    "workspace_read",
    "workspace_write",
    "workspace_undo",
    "blocky_cli",
    "project_context",
];
const ERROR: &str = "BLK-CODING-INPUT";
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Message {
    pub role: String,
    pub text: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CodingStart {
    pub schema_version: String,
    pub request_id: String,
    pub project_id: String,
    pub module_id: String,
    pub prompt: String,
    pub original_json: String,
    pub resource_id: String,
    pub selection: Vec<String>,
    pub conversation: Vec<Message>,
    pub workspace_id: Option<String>,
}
pub(crate) fn text_safe(text: &str) -> Result<(), String> {
    files::safe_text(text)
}
impl CodingStart {
    pub fn validate(&self) -> Result<Value, String> {
        if self.schema_version != "blocky.coding-start/v1"
            || [
                &self.request_id,
                &self.project_id,
                &self.module_id,
                &self.resource_id,
            ]
            .iter()
            .any(|s| s.len() > 200 || !crate::project_store::stable(s))
            || self
                .workspace_id
                .as_ref()
                .is_some_and(|s| s.len() > 200 || !crate::project_store::stable(s))
            || self.prompt.trim().is_empty()
            || self.prompt.encode_utf16().count() > 16000
            || self.original_json.len() > 8 * 1024 * 1024
            || self.selection.len() > 100
            || self
                .selection
                .iter()
                .any(|s| s.len() > 200 || !crate::project_store::stable(s))
            || self.selection.iter().collect::<HashSet<_>>().len() != self.selection.len()
            || self.conversation.len() > 20
            || self
                .conversation
                .iter()
                .map(|m| m.text.encode_utf16().count())
                .sum::<usize>()
                > 64000
            || self.conversation.iter().any(|m| {
                !["user", "assistant"].contains(&m.role.as_str())
                    || m.text.trim().is_empty()
                    || m.text.encode_utf16().count() > 16000
            })
        {
            return Err(ERROR.into());
        }
        files::safe_text(&self.prompt)?;
        for message in &self.conversation {
            files::safe_text(&message.text)?;
        }
        let p = crate::strict_json::parse(self.original_json.as_bytes()).map_err(|_| ERROR)?;
        if crate::builder::contains_credentials(
            &json!({"prompt":self.prompt,"conversation":self.conversation,"project":p}),
        ) {
            return Err(ERROR.into());
        }
        crate::patch_guard::project_files(&p)?;
        if p["manifest"]["projectId"] != self.project_id
            || p["manifest"]["modules"]
                .as_array()
                .is_none_or(|a| !a.iter().any(|m| m["moduleId"] == self.module_id))
        {
            return Err(ERROR.into());
        }
        Ok(p)
    }
}
#[derive(Default)]
struct State {
    workspaces: HashMap<String, Arc<files::Scope>>,
    changes: HashMap<String, (String, Value)>,
    active: HashMap<String, Arc<AtomicBool>>,
    used: HashSet<String>,
    api_called: HashSet<String>,
    completed: HashMap<String, (String, Value)>,
    receipts: HashMap<String, Vec<Value>>,
    closing: bool,
}
#[derive(Clone, Default)]
pub struct CodingHost {
    state: Arc<Mutex<State>>,
}
pub(super) fn registry(root: &Path) -> Result<Value, String> {
    Ok(crate::user_store::UserStore::new(root.join("user"))
        .read("resources", "app")?
        .unwrap_or(json!({"resources":[]})))
}
impl CodingHost {
    pub fn grant(&self, path: &Path) -> Result<Value, String> {
        let scope = Arc::new(files::Scope::new(path)?);
        let display = path
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("工作目录")
            .chars()
            .filter(|c| !c.is_control())
            .take(200)
            .collect::<String>();
        let id = format!("workspace-{}", uuid::Uuid::new_v4());
        let mut s = self.state.lock().map_err(|_| "BLK-CODING-STATE")?;
        if s.closing || !s.active.is_empty() || s.workspaces.len() >= 64 {
            return Err("BLK-CODING-STATE".into());
        }
        s.workspaces.insert(id.clone(), scope);
        Ok(json!({"workspaceId":id,"displayName":display}))
    }
    fn scope(&self, id: Option<&str>) -> Result<Option<Arc<files::Scope>>, String> {
        let s = self.state.lock().map_err(|_| "BLK-CODING-STATE")?;
        id.map(|id| {
            s.workspaces
                .get(id)
                .cloned()
                .ok_or("BLK-CODING-WORKSPACE".into())
        })
        .transpose()
    }
    pub fn preflight(&self, root: &Path, start: &CodingStart) -> Result<Value, String> {
        let p = start.validate()?;
        let scope = self.scope(start.workspace_id.as_deref())?;
        let model = BuilderModel::coding(
            root,
            &start.request_id,
            &start.project_id,
            &start.resource_id,
        )?;
        let digest = self.approval_digest(start, &model)?;
        Ok(
            json!({"requestDigest":digest,"provider":model.provider(),"modelId":model.model(),"destination":model.destination(root)?,"projectName":p["manifest"]["displayName"],"workspace":scope.as_ref().and_then(|s|s.root.file_name()).and_then(|s|s.to_str()).unwrap_or("未选择目录"),"maxTurns":12,"maxOutputTokens":model.max_output_tokens(),"task":start.prompt.chars().take(300).collect::<String>()}),
        )
    }
    fn approval_digest(&self, start: &CodingStart, model: &BuilderModel) -> Result<String, String> {
        Ok(files::digest(&format!(
            "{}:{}",
            serde_json::to_string(start).map_err(|_| ERROR)?,
            model.digest()?
        )))
    }
    pub fn run(
        &self,
        root: PathBuf,
        start: CodingStart,
        approval: &str,
        on_event: &mut dyn FnMut(Value) -> Result<(), String>,
    ) -> Result<Value, String> {
        let project = start.validate()?;
        let scope = self.scope(start.workspace_id.as_deref())?;
        let binding = BuilderModel::coding(
            &root,
            &start.request_id,
            &start.project_id,
            &start.resource_id,
        )?;
        if self.approval_digest(&start, &binding)? != approval {
            return Err("BLK-PERM-001".into());
        }
        let cancel = Arc::new(AtomicBool::new(false));
        {
            let mut s = self.state.lock().map_err(|_| "BLK-CODING-STATE")?;
            if s.closing
                || !s.active.is_empty()
                || s.used.contains(&start.request_id)
                || s.used.len() >= 4096
            {
                return Err("BLK-CODING-STATE".into());
            }
            s.used.insert(start.request_id.clone());
            s.active.insert(start.request_id.clone(), cancel.clone());
        }
        let result = process::run(
            self,
            &root,
            &start,
            project,
            scope.as_deref(),
            &binding,
            &cancel,
            on_event,
        );
        let mut s = self.state.lock().map_err(|_| "BLK-CODING-STATE")?;
        s.active.remove(&start.request_id);
        if cancel.load(Ordering::SeqCst) {
            return Err("BLK-CODING-CANCELLED".into());
        }
        let result = result?;
        if result.get("project").is_some() {
            if s.completed.len() >= 16 {
                if let Some(old) = s.completed.keys().next().cloned() {
                    s.completed.remove(&old);
                }
            }
            s.completed.insert(
                start.request_id.clone(),
                (start.original_json, result["project"].clone()),
            );
        }
        Ok(result)
    }
    pub fn cancel(&self, request_id: &str) -> Result<(), String> {
        if request_id.len() > 200 || !crate::project_store::stable(request_id) {
            return Err(ERROR.into());
        }
        let mut s = self.state.lock().map_err(|_| "BLK-CODING-STATE")?;
        if let Some(c) = s.active.get(request_id) {
            c.store(true, Ordering::SeqCst);
        } else if s.used.len() < 4096 {
            s.used.insert(request_id.to_owned());
        }
        Ok(())
    }
    pub fn shutdown(&self) -> Result<(), String> {
        {
            let mut s = self.state.lock().map_err(|_| "BLK-CODING-STATE")?;
            s.closing = true;
            for c in s.active.values() {
                c.store(true, Ordering::SeqCst);
            }
        }
        let begin = Instant::now();
        while !self
            .state
            .lock()
            .map_err(|_| "BLK-CODING-STATE")?
            .active
            .is_empty()
        {
            if begin.elapsed() > Duration::from_secs(3) {
                return Err("BLK-CODING-TIMEOUT".into());
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        Ok(())
    }
    pub fn undo(&self, workspace_id: &str, change_id: &str) -> Result<Value, String> {
        let mut s = self.state.lock().map_err(|_| "BLK-CODING-STATE")?;
        if s.closing || !s.active.is_empty() {
            return Err("BLK-CODING-STATE".into());
        }
        undo_locked(&mut s, workspace_id, change_id, None)
    }
    #[cfg(test)]
    fn record(&self, workspace_id: &str, change: &Value) -> Result<(), String> {
        let mut s = self.state.lock().map_err(|_| "BLK-CODING-STATE")?;
        if s.changes.len() >= 128 {
            return Err("BLK-CODING-BUDGET".into());
        }
        s.changes.insert(
            change["changeId"].as_str().ok_or(ERROR)?.to_owned(),
            (workspace_id.to_owned(), change.clone()),
        );
        Ok(())
    }
    pub(super) fn note_external_call(&self, id: &str) -> Result<(), String> {
        self.state
            .lock()
            .map_err(|_| "BLK-CODING-STATE")?
            .api_called
            .insert(id.to_owned());
        Ok(())
    }
    pub(super) fn model_api_called(&self, id: &str) -> bool {
        self.state.lock().is_ok_and(|s| s.api_called.contains(id))
    }
    pub fn changes(&self, request_id: &str) -> Result<Vec<Value>, String> {
        if request_id.len() > 200 || !crate::project_store::stable(request_id) {
            return Err(ERROR.into());
        }
        let s = self.state.lock().map_err(|_| "BLK-CODING-STATE")?;
        if !s.used.contains(request_id) {
            return Err("BLK-CODING-STALE".into());
        }
        Ok(s.receipts.get(request_id).cloned().unwrap_or_default())
    }
    pub fn validate_project(
        &self,
        root: &Path,
        request_id: &str,
        original_json: &str,
        project: &Value,
        approved: &[String],
    ) -> Result<Value, String> {
        let s = self.state.lock().map_err(|_| "BLK-CODING-STATE")?;
        let (original, candidate) = s.completed.get(request_id).ok_or("BLK-CODING-STALE")?;
        if original != original_json || candidate != project {
            return Err("BLK-CODING-STALE".into());
        }
        let old = crate::strict_json::parse(original.as_bytes())?;
        crate::patch_guard::project_files(project)?;
        let registry = registry(root)?;
        let before = crate::patch_guard::permissions(&old, &registry, true)?;
        let after = crate::patch_guard::permissions(project, &registry, false)?;
        if !after.difference(&before).all(|p| approved.contains(p)) {
            return Err("BLK-PATCH-003".into());
        }
        Ok(project.clone())
    }
    fn tool(
        &self,
        start: &CodingStart,
        scope: Option<&files::Scope>,
        cli: &mut cli::Cli,
        name: &str,
        args: &Value,
        cancel: &AtomicBool,
    ) -> Result<Value, String> {
        if cancel.load(Ordering::SeqCst) {
            return Err("BLK-CODING-CANCELLED".into());
        }
        if args.to_string().len() > files::LIMIT + 8192
            || crate::builder::contains_credentials(args)
        {
            return Err(ERROR.into());
        }
        let workspace = start.workspace_id.as_deref();
        let scope_required = || scope.ok_or("BLK-CODING-WORKSPACE".to_owned());
        match name {
            "project_context" => {
                fields(args, &[])?;
                Ok(
                    json!({"project":cli.project,"moduleId":start.module_id,"selection":start.selection}),
                )
            }
            "workspace_list" => {
                fields(args, &["path"])?;
                Ok(json!({"entries":scope_required()?.list(optional_text(args,"path")?)?}))
            }
            "workspace_search" => {
                fields(args, &["query", "path"])?;
                scope_required()?.search_cancellable(
                    text(args, "query")?,
                    optional_text(args, "path")?,
                    cancel,
                )
            }
            "workspace_read" => {
                fields(args, &["path"])?;
                scope_required()?.read(text(args, "path")?)
            }
            "workspace_write" => {
                fields(args, &["path", "text", "expectedDigest"])?;
                let expected = match args.get("expectedDigest") {
                    Some(Value::Null) => None,
                    Some(Value::String(s))
                        if s.len() == 64
                            && s.bytes()
                                .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()) =>
                    {
                        Some(s.as_str())
                    }
                    _ => return Err(ERROR.into()),
                };
                // Reserve a bounded journal slot before any actual write.
                let mut state = self.state.lock().map_err(|_| "BLK-CODING-STATE")?;
                if cancel.load(Ordering::SeqCst) {
                    return Err("BLK-CODING-CANCELLED".into());
                }
                reserve_receipt(&mut state, false)?;
                let change = scope_required()?.write_tracked(
                    text(args, "path")?,
                    text(args, "text")?,
                    expected,
                    &mut |change| {
                        if let Some(id) = change["changeId"].as_str() {
                            state.changes.insert(
                                id.to_owned(),
                                (workspace.unwrap_or("").to_owned(), change.clone()),
                            );
                        }
                        state
                            .receipts
                            .entry(start.request_id.clone())
                            .or_default()
                            .push(change);
                    },
                )?;
                state.changes.insert(
                    change["changeId"].as_str().ok_or(ERROR)?.to_owned(),
                    (workspace.ok_or(ERROR)?.to_owned(), change.clone()),
                );
                state
                    .receipts
                    .entry(start.request_id.clone())
                    .or_default()
                    .push(change.clone());
                Ok(json!({"change":change}))
            }
            "workspace_undo" => {
                fields(args, &["changeId"])?;
                let mut state = self.state.lock().map_err(|_| "BLK-CODING-STATE")?;
                if cancel.load(Ordering::SeqCst) {
                    return Err("BLK-CODING-CANCELLED".into());
                }
                let change = undo_locked(
                    &mut state,
                    workspace.ok_or("BLK-CODING-WORKSPACE")?,
                    text(args, "changeId")?,
                    Some(&start.request_id),
                )?;
                Ok(json!({"change":change}))
            }
            "blocky_cli" => {
                fields(args, &["args"])?;
                let args = args["args"]
                    .as_array()
                    .ok_or(ERROR)?
                    .iter()
                    .map(|v| v.as_str().map(str::to_owned).ok_or(ERROR.to_owned()))
                    .collect::<Result<Vec<_>, _>>()?;
                cli.run(&args, scope, cancel)
            }
            _ => Err(ERROR.into()),
        }
    }
}
fn reserve_receipt(state: &mut State, replacing: bool) -> Result<(), String> {
    fn full(s: &State) -> bool {
        s.receipts.values().map(Vec::len).sum::<usize>() >= 512
            || s.receipts
                .values()
                .flatten()
                .map(|c| c.to_string().len())
                .sum::<usize>()
                + 4 * files::LIMIT
                + 4096
                > 64 * 1024 * 1024
    }
    // Superseded undo receipts can be compacted; every currently registered
    // recoverable change remains queryable. The original journal slot survives
    // refusal or a failed mutation.
    if full(state) {
        let active: HashSet<String> = state.changes.keys().cloned().collect();
        for changes in state.receipts.values_mut() {
            changes.retain(|c| c["changeId"].as_str().is_some_and(|id| active.contains(id)));
        }
        state.receipts.retain(|_, changes| !changes.is_empty());
    }
    if (!replacing && state.changes.len() >= 128) || full(state) {
        return Err("BLK-CODING-BUDGET".into());
    }
    Ok(())
}
fn undo_locked(
    s: &mut State,
    workspace: &str,
    id: &str,
    current_request: Option<&str>,
) -> Result<Value, String> {
    let (owner, change) = s.changes.get(id).ok_or("BLK-CODING-CHANGE")?.clone();
    if owner != workspace {
        return Err("BLK-CODING-WORKSPACE".into());
    }
    // Replacing this slot cannot increase registered changes; reserve only journal growth.
    reserve_receipt(s, true)?;
    let request = current_request.map(str::to_owned).or_else(|| {
        s.receipts
            .iter()
            .find(|(_, changes)| changes.iter().any(|c| c["changeId"] == id))
            .map(|(r, _)| r.clone())
    });
    let scope = s
        .workspaces
        .get(workspace)
        .cloned()
        .ok_or("BLK-CODING-WORKSPACE")?;
    let mut result = scope.undo_tracked(&change, &mut |mut recovery| {
        recovery["invalidatesChangeId"] = json!(id);
        s.changes.remove(id);
        if let Some(change_id) = recovery["changeId"].as_str() {
            s.changes.insert(
                change_id.to_owned(),
                (workspace.to_owned(), recovery.clone()),
            );
        }
        if let Some(request) = &request {
            s.receipts
                .entry(request.clone())
                .or_default()
                .push(recovery);
        }
    })?;
    result["revertsChangeId"] = json!(id);
    s.changes.remove(id);
    s.changes.insert(
        result["changeId"].as_str().ok_or(ERROR)?.to_owned(),
        (workspace.to_owned(), result.clone()),
    );
    if let Some(request) = request {
        s.receipts.entry(request).or_default().push(result.clone());
    }
    Ok(result)
}

fn fields(args: &Value, allowed: &[&str]) -> Result<(), String> {
    if args
        .as_object()
        .is_none_or(|o| o.keys().any(|k| !allowed.contains(&k.as_str())))
    {
        return Err(ERROR.into());
    }
    Ok(())
}
fn text<'a>(args: &'a Value, key: &str) -> Result<&'a str, String> {
    args[key].as_str().ok_or(ERROR.into())
}
fn optional_text<'a>(args: &'a Value, key: &str) -> Result<Option<&'a str>, String> {
    args.get(key)
        .map(|v| v.as_str().ok_or(ERROR.into()))
        .transpose()
}
/// CLI receives no path capability from JSON. A fresh native picker creates its
/// private grant; task approval happens in the same helper process.
pub fn dispatch(root: PathBuf, value: &Value) -> Result<Value, String> {
    dispatch_cancellable(root, value, &AtomicBool::new(false))
}
pub(super) fn dispatch_cancellable(
    root: PathBuf,
    value: &Value,
    cancel: &AtomicBool,
) -> Result<Value, String> {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct Envelope {
        schema_version: String,
        operation: String,
        start: CodingStart,
        pick_workspace: bool,
    }
    let e: Envelope = serde_json::from_value(value.clone()).map_err(|_| ERROR)?;
    if e.schema_version != "blocky.project-io/v1alpha1"
        || e.operation != "coding-run"
        || e.start.workspace_id.is_some()
    {
        return Err(ERROR.into());
    }
    let host = CodingHost::default();
    let mut start = e.start;
    let (tx, rx) = std::sync::mpsc::channel();
    let watched = host.clone();
    let id = start.request_id.clone();
    let result = std::thread::scope(|threads| {
        let watcher = threads.spawn(move || {
            loop {
                if cancel.load(Ordering::SeqCst) {
                    let _ = watched.cancel(&id);
                    break;
                }
                match rx.recv_timeout(Duration::from_millis(20)) {
                    Ok(()) | Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
                    Err(_) => {}
                }
            }
        });
        let result = (|| {
            start.validate()?;
            if cancel.load(Ordering::SeqCst) {
                return Err("BLK-CODING-CANCELLED".into());
            }
            if e.pick_workspace {
                let path = rfd::FileDialog::new()
                    .set_title("选择代码助手工作目录")
                    .pick_folder()
                    .ok_or("BLK-PERM-001")?;
                if cancel.load(Ordering::SeqCst) {
                    return Err("BLK-CODING-CANCELLED".into());
                }
                start.workspace_id = Some(
                    host.grant(&path)?["workspaceId"]
                        .as_str()
                        .ok_or(ERROR)?
                        .to_owned(),
                );
            }
            let preview = host.preflight(&root, &start)?;
            if cancel.load(Ordering::SeqCst) {
                return Err("BLK-CODING-CANCELLED".into());
            }
            if rfd::MessageDialog::new()
                .set_title("批准代码助手任务")
                .set_description(approval_description(&preview))
                .set_buttons(rfd::MessageButtons::YesNo)
                .show()
                != rfd::MessageDialogResult::Yes
            {
                return Err("BLK-PERM-001".into());
            }
            if cancel.load(Ordering::SeqCst) {
                return Err("BLK-CODING-CANCELLED".into());
            }
            host.run(
                root,
                start.clone(),
                preview["requestDigest"].as_str().ok_or(ERROR)?,
                &mut |_| Ok(()),
            )
        })();
        let _ = tx.send(());
        let _ = watcher.join();
        result
    });
    let result = if cancel.load(Ordering::SeqCst) {
        Err("BLK-CODING-CANCELLED".to_owned())
    } else {
        result
    };
    match result {
        Ok(result) => Ok(result),
        Err(code) => {
            let code = if code.starts_with("BLK-")
                && code.len() < 128
                && code
                    .bytes()
                    .all(|b| b.is_ascii_uppercase() || b.is_ascii_digit() || b == b'-')
            {
                code
            } else {
                ERROR.to_owned()
            };
            Ok(failure_receipt(&host, &start, &code))
        }
    }
}
fn failure_receipt(host: &CodingHost, start: &CodingStart, code: &str) -> Value {
    json!({"schemaVersion":"blocky.coding-failure/v1","requestId":start.request_id,"projectId":start.project_id,"baseDigest":files::digest(&start.original_json),"code":code,"changes":host.changes(&start.request_id).unwrap_or_default(),"modelApiCalled":host.model_api_called(&start.request_id)})
}
pub fn approval_description(preview: &Value) -> String {
    format!(
        "代码助手将向 {} 发送当前项目、选择、本次对话和任务中读取的工作文件内容。\n任务：{}\n地址：{}\n项目：{}\n模型：{}\n目录范围：{}\n允许读取、编辑普通文本文件和调用确定性 Blocky CLI；每次修改保留差异，可按文件版本撤回。\n允许在隔离项目副本中生成、校验语义候选和补丁，候选仍需审查接受。\n最多 12 次模型请求，每次输出上限 {} tokens；任务最长 5 分钟。\n请求摘要：{}",
        preview["provider"],
        preview["task"],
        preview["destination"],
        preview["projectName"],
        preview["modelId"],
        preview["workspace"],
        preview["maxOutputTokens"],
        preview["requestDigest"]
    )
}
