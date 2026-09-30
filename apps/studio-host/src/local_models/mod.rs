mod artifacts;
mod config;
mod download;
#[cfg(windows)]
mod process;
mod store;
pub use config::LocalOptions;
#[cfg(windows)]
pub(crate) use process::LocalSession;
#[cfg(not(windows))]
mod unsupported;
use serde_json::Value;
use std::{
    path::{Path, PathBuf},
    sync::atomic::{AtomicBool, Ordering},
};
pub use store::{install, remove, status, verify};
#[cfg(not(windows))]
pub(crate) use unsupported::LocalSession;
pub const MODEL_ID: &str = "qwen3-0.6b-q8-v1";
const INVALID: &str = "BLK-LOCAL-MODEL-INVALID";
const IO: &str = "BLK-LOCAL-MODEL-IO";
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InstallSource {
    pub model_file: PathBuf,
    pub runtime_file: PathBuf,
}
pub fn catalog() -> Result<Value, String> {
    let lock = artifacts::lock()?;
    Ok(
        serde_json::json!({"models":[{"modelId":MODEL_ID,"displayName":"Qwen3 0.6B","modelBytes":lock.model.bytes,"modelSha256":lock.model.sha256,"runtimeVersion":lock.runtime_version,"modelRevision":lock.model_revision,"capabilities":["text","tools","structured-output"],"backends":lock.backends.iter().map(|b|serde_json::json!({"id":b.id,"downloadBytes":b.archive.bytes+lock.model.bytes,"installedBytes":lock.model.bytes+b.files.iter().map(|f|f.bytes).sum::<u64>()})).collect::<Vec<_>>(),"licenses":["MIT","Apache-2.0","LLVM OpenMP"],"externalApi":false}]}),
    )
}
pub fn dispatch(
    root: PathBuf,
    value: &Value,
    host: &crate::provider::ProviderHost,
) -> Result<Value, String> {
    #[derive(serde::Deserialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct Request {
        schema_version: String,
        operation: String,
        model_id: Option<String>,
        backend: Option<String>,
        request_id: Option<String>,
        source: Option<InstallSource>,
    }
    let r: Request = serde_json::from_value(value.clone()).map_err(|_| INVALID)?;
    if r.schema_version != "blocky.project-io/v1alpha1" {
        return Err(INVALID.into());
    }
    if r.operation == "provider-local-model-catalog"
        && r.model_id.is_none()
        && r.backend.is_none()
        && r.request_id.is_none()
        && r.source.is_none()
    {
        return catalog();
    }
    let id = r.model_id.ok_or(INVALID)?;
    match r.operation.as_str() {
        "provider-local-model-status"
            if r.backend.is_none() && r.source.is_none() && r.request_id.is_none() =>
        {
            status(&root, &id)
        }
        "provider-local-model-remove"
            if r.backend.is_none() && r.source.is_none() && r.request_id.is_none() =>
        {
            remove(&root, &id)
        }
        "provider-local-model-verify"
            if r.backend.is_none() && r.source.is_none() && r.request_id.is_none() =>
        {
            host.local_model_verify(&root, &id)
        }
        "provider-local-model-install" => host.local_model_install(
            &root,
            &id,
            &r.backend.ok_or(INVALID)?,
            &r.request_id.ok_or(INVALID)?,
            r.source.as_ref(),
        ),
        _ => Err(INVALID.into()),
    }
}
#[cfg(test)]
mod tests;
