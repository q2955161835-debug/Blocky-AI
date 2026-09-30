pub(crate) mod builder;
pub(crate) mod builder_model;
#[cfg(test)]
mod builder_tests;
pub mod gateway;
mod transport;
mod types;
use serde_json::Value;
use std::{
    collections::{HashMap, HashSet},
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};
pub use types::ProviderRequest;
#[derive(Default)]
struct State {
    active: HashMap<String, Arc<AtomicBool>>,
    used: HashSet<String>,
    closing: bool,
}
#[derive(Clone, Default)]
pub struct ProviderHost {
    state: Arc<Mutex<State>>,
}
impl ProviderHost {
    /// Shared request lifetime for native adapters. This grants no provider or
    /// filesystem capability; the caller still validates its own typed binding.
    pub(crate) fn begin_cancellable(&self, id: &str) -> Result<ActiveRequest, String> {
        if id.len() > 128 || !crate::project_store::stable(id) {
            return Err(types::INVALID.into());
        }
        self.begin(id)
    }
    pub fn local_model_install(
        &self,
        root: &std::path::Path,
        id: &str,
        backend: &str,
        request_id: &str,
        source: Option<&crate::local_models::InstallSource>,
    ) -> Result<Value, String> {
        if request_id.len() > 128 || !crate::project_store::stable(request_id) {
            return Err(types::INVALID.into());
        }
        let active = self.begin(request_id)?;
        crate::local_models::install(root, id, backend, source, &active.cancel)
    }
    pub fn local_model_verify(&self, root: &std::path::Path, id: &str) -> Result<Value, String> {
        self.local_model_verify_request(
            root,
            id,
            &format!("verify-{}", uuid::Uuid::new_v4().simple()),
        )
    }
    pub fn local_model_verify_request(
        &self,
        root: &std::path::Path,
        id: &str,
        request_id: &str,
    ) -> Result<Value, String> {
        if request_id.len() > 128 || !crate::project_store::stable(request_id) {
            return Err(types::INVALID.into());
        }
        let active = self.begin(request_id)?;
        crate::local_models::verify(root, id, &active.cancel)
    }
    fn begin(&self, id: &str) -> Result<ActiveRequest, String> {
        let cancel = Arc::new(AtomicBool::new(false));
        let mut s = self.state.lock().map_err(|_| "BLK-PROVIDER-STATE")?;
        if s.closing || s.used.contains(id) || s.active.len() >= 2 || s.used.len() >= 4096 {
            return Err("BLK-PROVIDER-STATE".into());
        }
        s.used.insert(id.to_owned());
        s.active.insert(id.to_owned(), cancel.clone());
        Ok(ActiveRequest {
            host: self.clone(),
            id: id.to_owned(),
            cancel,
        })
    }
    pub fn preflight(&self, root: &std::path::Path, r: &ProviderRequest) -> Result<Value, String> {
        let registry = crate::user_store::UserStore::new(root.join("user"))
            .read("resources", "app")?
            .ok_or("BLK-PROVIDER-CONFIG")?;
        types::check_binding(&registry, r)?;
        if !crate::secret_store::SecretStore::new(root.join("secrets")).contains(&r.secret_ref)? {
            return Err("BLK-PROVIDER-CONFIG".into());
        }
        r.preflight()
    }
    pub fn call(&self, root: PathBuf, r: ProviderRequest, digest: &str) -> Result<Value, String> {
        if r.digest()? != digest {
            return Err("BLK-PERM-001".into());
        }
        self.preflight(&root, &r)?;
        let active = self.begin(&r.request_id)?;
        let result = crate::secret_store::SecretStore::new(root.join("secrets"))
            .with_secret(&r.secret_ref, |key| {
                transport::send(&r, key, &active.cancel)
            })
            .and_then(|v| v);
        let cancelled = active.cancel.load(Ordering::SeqCst);
        if cancelled {
            Err("BLK-PROVIDER-CANCELLED".into())
        } else {
            result
        }
    }
    pub fn cancel(&self, id: &str) -> Result<(), String> {
        if id.len() > 128 || !crate::project_store::stable(id) {
            return Err(types::INVALID.into());
        }
        let mut s = self.state.lock().map_err(|_| "BLK-PROVIDER-STATE")?;
        if let Some(flag) = s.active.get(id) {
            flag.store(true, Ordering::SeqCst);
        } else if s.used.len() < 4096 {
            s.used.insert(id.to_string());
        }
        Ok(())
    }
    pub fn shutdown(&self) -> Result<(), String> {
        {
            let mut s = self.state.lock().map_err(|_| "BLK-PROVIDER-STATE")?;
            s.closing = true;
            for flag in s.active.values() {
                flag.store(true, Ordering::SeqCst);
            }
        }
        let started = Instant::now();
        while !self
            .state
            .lock()
            .map_err(|_| "BLK-PROVIDER-STATE")?
            .active
            .is_empty()
        {
            if started.elapsed() > Duration::from_secs(2) {
                return Err("BLK-PROVIDER-TIMEOUT".into());
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        Ok(())
    }
}
pub(crate) struct ActiveRequest {
    host: ProviderHost,
    id: String,
    pub(crate) cancel: Arc<AtomicBool>,
}
impl Drop for ActiveRequest {
    fn drop(&mut self) {
        if let Ok(mut state) = self.host.state.lock() {
            state.active.remove(&self.id);
        }
    }
}
pub fn dispatch(root: PathBuf, value: &Value) -> Result<Value, String> {
    if value["operation"]
        .as_str()
        .is_some_and(|s| s.starts_with("provider-local-model-"))
    {
        return crate::local_models::dispatch(root, value, &ProviderHost::default());
    }
    if value["operation"]
        .as_str()
        .is_some_and(|s| s.starts_with("provider-model-"))
    {
        return gateway::dispatch(root, value);
    }
    #[derive(serde::Deserialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct Envelope {
        schema_version: String,
        operation: String,
        request: ProviderRequest,
        approval: Option<Approval>,
    }
    #[derive(serde::Deserialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct Approval {
        request_digest: String,
        approved: bool,
    }
    let e: Envelope = serde_json::from_value(value.clone()).map_err(|_| types::INVALID)?;
    if e.schema_version != "blocky.project-io/v1alpha1" {
        return Err(types::INVALID.into());
    }
    let host = ProviderHost::default();
    match e.operation.as_str() {
        "provider-preflight" if e.approval.is_none() => {
            let mut preview = host.preflight(&root, &e.request)?;
            let expires = crate::approval_ledger::issue(
                &root.join("approvals"),
                &format!("provider/{}/{}", e.request.project_id, e.request.request_id),
                &e.request.digest()?,
            )?;
            preview["approvalExpiresAt"] = expires.into();
            Ok(preview)
        }
        "provider-call" => {
            let a = e.approval.filter(|a| a.approved).ok_or("BLK-PERM-001")?;
            if a.request_digest != e.request.digest()? {
                return Err("BLK-PERM-001".into());
            }
            crate::approval_ledger::consume(
                &root.join("approvals"),
                &format!("provider/{}/{}", e.request.project_id, e.request.request_id),
                &a.request_digest,
            )?;
            host.call(root, e.request, &a.request_digest)
        }
        _ => Err(types::INVALID.into()),
    }
}
#[cfg(test)]
mod tests;
