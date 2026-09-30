use super::{ToolHost, ToolRequest};
use serde::Deserialize;
use serde_json::Value;
use std::{path::Path, sync::atomic::AtomicBool};
const INVALID: &str = "BLK-TOOL-INVALID";
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Approval {
    approved: bool,
    request_digest: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Envelope {
    schema_version: String,
    operation: String,
    request: Option<ToolRequest>,
    approval: Option<Approval>,
    project_id: Option<String>,
    request_id: Option<String>,
    outcome: Option<String>,
}
pub fn execute(root: &Path, value: &Value, cancel: &AtomicBool) -> Result<Value, String> {
    let e: Envelope = serde_json::from_value(value.clone()).map_err(|_| INVALID)?;
    if e.schema_version != "blocky.project-io/v1alpha1" {
        return Err(INVALID.into());
    }
    let host = ToolHost::default();
    match e.operation.as_str() {
        "tool-cleanup-status" | "tool-cleanup"
            if e.request.is_none()
                && e.approval.is_none()
                && e.project_id.is_none()
                && e.request_id.is_none()
                && e.outcome.is_none() =>
        {
            if e.operation == "tool-cleanup-status" {
                host.cleanup_status(root)
            } else {
                host.cleanup(root)
            }
        }
        "tool-status"
            if e.request.is_none()
                && e.approval.is_none()
                && e.request_id.is_none()
                && e.outcome.is_none() =>
        {
            host.status(root, e.project_id.as_deref().ok_or(INVALID)?)
        }
        "tool-preflight" | "tool-call"
            if e.project_id.is_none() && e.request_id.is_none() && e.outcome.is_none() =>
        {
            let request = e.request.ok_or(INVALID)?;
            let mut preview = host.preflight(root, &request)?;
            let digest = preview["requestDigest"].as_str().ok_or(INVALID)?.to_owned();
            let identity = format!("tool-v2/{}/{}", request.project_id, request.request_id);
            if e.operation == "tool-preflight" {
                if e.approval.is_some() {
                    return Err(INVALID.into());
                }
                preview["approvalExpiresAt"] =
                    crate::approval_ledger::issue(&root.join("approvals"), &identity, &digest)?
                        .into();
                Ok(preview)
            } else {
                let a = e
                    .approval
                    .filter(|a| a.approved && a.request_digest == digest)
                    .ok_or("BLK-PERM-001")?;
                crate::approval_ledger::consume(
                    &root.join("approvals"),
                    &identity,
                    &a.request_digest,
                )?;
                host.call_with_cancel(root, &request, &digest, cancel)
            }
        }
        "tool-reconcile-preflight" | "tool-reconcile" if e.request.is_none() => {
            let project = e.project_id.as_deref().ok_or(INVALID)?;
            let request = e.request_id.as_deref().ok_or(INVALID)?;
            let outcome = e.outcome.as_deref().ok_or(INVALID)?;
            let mut preview = host.reconcile_preview(root, project, request, outcome)?;
            let digest = preview["requestDigest"].as_str().ok_or(INVALID)?.to_owned();
            let identity = format!("tool-reconcile/{project}/{request}");
            if e.operation == "tool-reconcile-preflight" {
                if e.approval.is_some() {
                    return Err(INVALID.into());
                }
                preview["approvalExpiresAt"] =
                    crate::approval_ledger::issue(&root.join("approvals"), &identity, &digest)?
                        .into();
                Ok(preview)
            } else {
                let a = e
                    .approval
                    .filter(|a| a.approved && a.request_digest == digest)
                    .ok_or("BLK-PERM-001")?;
                crate::approval_ledger::consume(
                    &root.join("approvals"),
                    &identity,
                    &a.request_digest,
                )?;
                host.reconcile(root, project, request, outcome, &digest)
            }
        }
        _ => Err(INVALID.into()),
    }
}
pub fn session_main() -> i32 {
    crate::native_session::run(65536, INVALID, |value, cancel| {
        if value["operation"] != "tool-call" {
            return Err(INVALID.into());
        }
        execute(&crate::profile::cli_root()?, &value, cancel)
    })
}
