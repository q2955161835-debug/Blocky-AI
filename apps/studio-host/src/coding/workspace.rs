use super::{CodingHost, ERROR, files, fields, text, optional_text, reserve_receipt, undo_locked};
use serde_json::{Value, json};
use std::sync::atomic::{AtomicBool, Ordering};
use serde::Deserialize;

#[derive(Deserialize)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
pub struct WorkspaceRequest {
    pub schema_version: String,
    pub project_id: String,
    pub request_id: String,
    pub operation: String,
    pub input: Value,
}

pub(super) fn validate_runtime_context(context: &Value) -> Result<(), String> {
    fields(context, &["diagnostics","recentEvents"])?;
    if context.to_string().len() > 8192 { return Err(ERROR.into()); }
    for (kind, allowed) in [("diagnostics",vec!["code","severity","moduleId","blockId"]),("recentEvents",vec!["type","code","moduleId","blockId"])] {
        let entries = context[kind].as_array().ok_or(ERROR)?;
        if entries.len() > 20 { return Err(ERROR.into()); }
        for entry in entries {
            fields(entry, &allowed)?;
            for key in ["moduleId","blockId"] { if let Some(value)=entry.get(key) { let value=value.as_str().ok_or(ERROR)?; if value.len()>200 || !crate::project_store::stable(value) { return Err(ERROR.into()); } } }
            if let Some(code)=entry.get("code") { let code=code.as_str().ok_or(ERROR)?; if code.len()>128 || code.len()<5 || !code.starts_with("BLK-") || !code.bytes().all(|c|c.is_ascii_uppercase()||c.is_ascii_digit()||c==b'-') { return Err(ERROR.into()); } }
            if kind=="diagnostics" { if entry.get("code").is_none() || !["info","warning","error"].contains(&entry["severity"].as_str().unwrap_or("")) { return Err(ERROR.into()); } }
            else { let event=entry["type"].as_str().ok_or(ERROR)?; if event.is_empty()||event.len()>64||!event.bytes().all(|c|c.is_ascii_alphanumeric()||[b'.',b'-',b'_'].contains(&c)) { return Err(ERROR.into()); } }
        }
    }
    Ok(())
}

impl CodingHost {
    pub fn grant_project(&self, project_id: &str, path: &std::path::Path) -> Result<Value,String> {
        if project_id.len()>200 || !crate::project_store::stable(project_id) { return Err(ERROR.into()); }
        let grant = self.grant(path)?;
        self.state.lock().map_err(|_|"BLK-CODING-STATE")?.project_workspaces.insert(project_id.to_owned(), grant["workspaceId"].as_str().ok_or(ERROR)?.to_owned());
        Ok(grant)
    }
    pub fn workspace_status(&self, project_id: &str) -> Result<Value,String> {
        if project_id.len()>200 || !crate::project_store::stable(project_id) { return Err(ERROR.into()); }
        let state = self.state.lock().map_err(|_|"BLK-CODING-STATE")?;
        let id = state.project_workspaces.get(project_id);
        let display = id.and_then(|id| state.workspaces.get(id)).and_then(|scope|scope.root.file_name()).and_then(|name|name.to_str());
        let changes: Vec<Value> = state.changes.values().filter(|(owner,_)|Some(owner)==id).map(|(_,change)|change.clone()).collect();
        Ok(json!({"available":id.is_some(),"workspaceId":id,"displayName":display,"changes":changes}))
    }
    pub fn workspace_call(&self, request: WorkspaceRequest) -> Result<Value,String> {
        if request.schema_version!="blocky.workspace-request/v1" || [&request.project_id,&request.request_id].iter().any(|id| id.len()>200 || !crate::project_store::stable(id)) || !["list","search","read","write","undo","check"].contains(&request.operation.as_str()) { return Err(ERROR.into()); }
        let cancel = std::sync::Arc::new(AtomicBool::new(false));
        let workspace = {
            let mut state = self.state.lock().map_err(|_|"BLK-CODING-STATE")?;
            if state.closing || state.used.contains(&request.request_id) || state.used.len()>=4096 || !state.active.is_empty() { return Err("BLK-CODING-STATE".into()); }
            let workspace = state.project_workspaces.get(&request.project_id).cloned().ok_or("BLK-CODING-WORKSPACE")?;
            state.used.insert(request.request_id.clone()); state.active.insert(request.request_id.clone(),cancel.clone()); workspace
        };
        let result = self.scope(Some(&workspace)).and_then(|scope| {
            self.runtime_result_budget(&workspace, scope.as_deref(), &request.operation, &request.input)?;
            let value=self.workspace_operation(Some(&workspace),scope.as_deref(),&request.request_id,&format!("workspace_{}",request.operation),&request.input,&cancel)?;
            if value.to_string().len()>32768 { return Err("BLK-TOOL-LIMIT".into()); }
            Ok(value)
        });
        self.state.lock().map_err(|_|"BLK-CODING-STATE")?.active.remove(&request.request_id);
        result
    }
    // Runtime tool results have a smaller bound than the coding assistant's file
    // journal. Check the complete diff before mutation, including escaped text.
    fn runtime_result_budget(&self, workspace: &str, scope: Option<&files::Scope>, operation: &str, args: &Value) -> Result<(),String> {
        if operation=="write" {
            fields(args,&["path","text","expectedDigest"])?;
            let path=text(args,"path")?; let after=text(args,"text")?;
            let before=if args["expectedDigest"].as_str().is_some_and(|s|!s.is_empty()) {
                scope.ok_or("BLK-CODING-WORKSPACE")?.read(path)?["text"].clone()
            } else { Value::Null };
            if json!({"before":before,"after":after,"path":path}).to_string().len()+2048>32768 { return Err("BLK-TOOL-LIMIT".into()); }
        } else if operation=="undo" {
            fields(args,&["changeId"])?;
            let state=self.state.lock().map_err(|_|"BLK-CODING-STATE")?;
            if let Some((owner,change))=state.changes.get(text(args,"changeId")?) {
                if owner!=workspace { return Err("BLK-CODING-WORKSPACE".into()); }
                if change.to_string().len()+2048>32768 { return Err("BLK-TOOL-LIMIT".into()); }
            }
        }
        Ok(())
    }
    pub(super) fn workspace_operation(&self, workspace: Option<&str>, scope: Option<&files::Scope>, request_id: &str, name: &str, args: &Value, cancel: &AtomicBool) -> Result<Value,String> {
        if cancel.load(Ordering::SeqCst) { return Err("BLK-CODING-CANCELLED".into()); }
        if args.to_string().len() > files::LIMIT + 8192 || crate::builder::contains_credentials(args) { return Err(ERROR.into()); }
        let scope_required = || scope.ok_or("BLK-CODING-WORKSPACE".to_owned());
        match name {
            "workspace_list" => {
                fields(args, &["path"])?;
                let entries=scope_required()?.list(optional_text(args,"path")?)?;
                let state=self.state.lock().map_err(|_|"BLK-CODING-STATE")?;
                let mut changes: Vec<Value>=state.changes.values().filter(|(owner,_)|Some(owner.as_str())==workspace).map(|(_,change)|json!({"changeId":change["changeId"],"path":change["path"],"beforeDigest":change["beforeDigest"],"afterDigest":change["afterDigest"]})).collect();
                changes.sort_by(|a,b|a["changeId"].as_str().cmp(&b["changeId"].as_str()));
                Ok(json!({"entries":entries,"changes":changes}))
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
                    Some(Value::String(s)) if s.is_empty() => None,
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
                            .entry(request_id.to_owned())
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
                    .entry(request_id.to_owned())
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
                    Some(&request_id),
                )?;
                Ok(json!({"change":change}))
            }
            "workspace_check" => { fields(args, &["path", "kind"])?; super::check::check(scope_required()?, text(args,"path")?, text(args,"kind")?, cancel) }
            _ => Err(ERROR.into()),
        }
    }
}
