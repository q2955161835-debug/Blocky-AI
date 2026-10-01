mod binding;
mod bundle;
pub mod dispatch;
mod http;
mod mcp;
mod protocol;
mod receipts;
pub use protocol::ToolRequest;
use serde_json::{json, Value};
use std::{
    path::Path,
    sync::atomic::Ordering,
    time::{Duration, Instant},
};
#[derive(Clone, Default)]
pub struct ToolHost {
    gate: crate::provider::ProviderHost,
}
impl ToolHost {
    pub fn cleanup_status(&self, root: &Path) -> Result<Value, String> {
        #[cfg(windows)]
        {
            crate::tool_sandbox::cleanup_status(root)
        }
        #[cfg(not(windows))]
        {
            let _ = root;
            Ok(
                json!({"incompleteSessions":0,"incompleteBytes":0,"activeSessions":0,"unrecognizedSessions":0}),
            )
        }
    }
    pub fn cleanup(&self, root: &Path) -> Result<Value, String> {
        #[cfg(windows)]
        {
            crate::tool_sandbox::cleanup(root)
        }
        #[cfg(not(windows))]
        {
            let _ = root;
            Ok(json!({"removedSessions":0,"removedBytes":0}))
        }
    }
    pub fn preflight(&self, root: &Path, r: &ToolRequest) -> Result<Value, String> {
        let bound = binding::Binding::load(root, r, &|| Ok(()))?;
        let mut preview = bound.preview(r);
        preview["unresolvedCalls"] = receipts::list(root, &r.project_id, Some(&r.resource_id))?
            .iter()
            .filter(|v| v["status"] == "unknown")
            .count()
            .into();
        Ok(preview)
    }
    pub fn destination(
        &self,
        root: &Path,
        r: &ToolRequest,
        digest: &str,
    ) -> Result<String, String> {
        let bound = binding::Binding::load(root, r, &|| Ok(()))?;
        if bound.digest != digest {
            return Err("BLK-PERM-001".into());
        }
        Ok(bound.endpoint.map(|u| u.to_string()).unwrap_or_else(|| {
            bound
                .launch
                .map(|l| l.bundle_path.display().to_string())
                .unwrap_or_else(|| "已登记工具".into())
        }))
    }
    pub fn call(&self, root: &Path, r: &ToolRequest, digest: &str) -> Result<Value, String> {
        self.call_with_cancel(root, r, digest, &std::sync::atomic::AtomicBool::new(false))
    }
    pub fn call_with_cancel(
        &self,
        root: &Path,
        r: &ToolRequest,
        digest: &str,
        external: &std::sync::atomic::AtomicBool,
    ) -> Result<Value, String> {
        self.begin(r)?.call_with_cancel(root, digest, external)
    }
    pub fn begin(&self, request: &ToolRequest) -> Result<ToolOperation, String> {
        request.validate()?;
        Ok(ToolOperation {
            request: request.clone(),
            active: self.gate.begin_cancellable(&request.request_id)?,
        })
    }

    pub fn cancel(&self, id: &str) -> Result<(), String> {
        self.gate.cancel(id)
    }
    pub fn shutdown(&self) -> Result<(), String> {
        self.gate.shutdown()
    }
    pub fn status(&self, root: &Path, project: &str) -> Result<Value, String> {
        Ok(json!({"receipts":receipts::list(root,project,None)?}))
    }
    pub fn reconcile_preview(
        &self,
        root: &Path,
        project: &str,
        request: &str,
        outcome: &str,
    ) -> Result<Value, String> {
        receipts::reconcile_preview(root, project, request, outcome)
    }
    pub fn reconcile(
        &self,
        root: &Path,
        project: &str,
        request: &str,
        outcome: &str,
        digest: &str,
    ) -> Result<Value, String> {
        receipts::reconcile(root, project, request, outcome, digest)
    }
}
/// Owns cancellation registration from the first preflight through approval and execution.
/// Dropping an operation settles its registration without enabling replay.
pub struct ToolOperation {
    request: ToolRequest,
    active: crate::provider::ActiveRequest,
}
impl ToolOperation {
    pub fn check_cancel(&self) -> Result<(), String> {
        if self.active.cancel.load(Ordering::SeqCst) {
            Err("BLK-TOOL-CANCELLED".into())
        } else {
            Ok(())
        }
    }
    pub fn preflight(&self, root: &Path) -> Result<Value, String> {
        self.check_cancel()?;
        let bound = binding::Binding::load(root, &self.request, &|| self.check_cancel())?;
        let mut preview = bound.preview(&self.request);
        preview["unresolvedCalls"] = receipts::list(
            root,
            &self.request.project_id,
            Some(&self.request.resource_id),
        )?
        .iter()
        .filter(|v| v["status"] == "unknown")
        .count()
        .into();
        self.check_cancel()?;
        Ok(preview)
    }
    pub fn destination(&self, root: &Path, digest: &str) -> Result<String, String> {
        self.check_cancel()?;
        let bound = binding::Binding::load(root, &self.request, &|| self.check_cancel())?;
        if bound.digest != digest {
            return Err("BLK-PERM-001".into());
        }
        self.check_cancel()?;
        Ok(bound.endpoint.map(|u| u.to_string()).unwrap_or_else(|| {
            bound
                .launch
                .map(|l| l.bundle_path.display().to_string())
                .unwrap_or_else(|| "已登记工具".into())
        }))
    }
    pub fn call(&self, root: &Path, digest: &str) -> Result<Value, String> {
        self.call_with_cancel(root, digest, &std::sync::atomic::AtomicBool::new(false))
    }
    fn call_with_cancel(
        &self,
        root: &Path,
        digest: &str,
        external: &std::sync::atomic::AtomicBool,
    ) -> Result<Value, String> {
        let r = &self.request;
        let started = Instant::now();
        let cancel = || {
            if self.active.cancel.load(Ordering::SeqCst) || external.load(Ordering::SeqCst) {
                Err("BLK-TOOL-CANCELLED".into())
            } else if started.elapsed() >= Duration::from_millis(r.timeout_ms) {
                Err("BLK-TOOL-TIMEOUT".into())
            } else {
                Ok(())
            }
        };
        let bound = binding::Binding::load(root, r, &cancel)?;
        if bound.digest != digest {
            return Err("BLK-PERM-001".into());
        }
        let mut receipt = receipts::Receipt::begin(root, r, digest)?;
        let may_have_started=std::sync::atomic::AtomicBool::new(false);
        let result = (|| {
            cancel()?;
            let result = if bound.adapter.starts_with("mcp-") {
                mcp::execute(root, &bound, r, &cancel,&may_have_started)?
            } else {
                // HTTP dispatch keeps the conservative unknown result policy.
                may_have_started.store(true,Ordering::SeqCst);
                http::execute(
                    bound.endpoint.clone().ok_or("BLK-TOOL-CONFIG")?,
                    bound.headers.clone(),
                    bound.mode,
                    bound.resource["definition"]["method"]
                        .as_str()
                        .ok_or("BLK-TOOL-CONFIG")?,
                    &r.input,
                    r.timeout_ms,
                    &cancel,
                )?
            };
            cancel()?;
            crate::mcp_client::validate_json(&result, 32768)?;
            if let Some(schema) = &bound.output_schema {
                crate::provider::gateway::validate_data(&result, schema)?;
            }
            Ok(result)
        })();
        receipt.finish(&result,if may_have_started.load(Ordering::SeqCst){receipts::EffectState::MayHaveStarted}else{receipts::EffectState::NotStarted})?;
        result
    }
}
#[cfg(test)]
mod tests;
