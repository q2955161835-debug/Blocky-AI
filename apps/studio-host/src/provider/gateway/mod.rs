pub(crate) mod binding;
mod budget;
mod endpoint;
mod protocol;
mod structured;
mod stream;
mod images;
use super::ProviderHost;
pub use endpoint::validate_endpoint;
pub use protocol::{parse_response, GatewayRequest, ModelMessage, ModelTool, ToolCall};
use serde_json::Value;
use std::{
    path::{Path, PathBuf},
    sync::atomic::Ordering,
    time::{Duration, Instant},
};
pub(crate) fn validate_data_schema(schema: &Value) -> Result<(), String> {
    protocol::schema(schema, 0).map_err(|_| "BLK-TOOL-SCHEMA".into())
}
pub(crate) fn validate_data(value: &Value, schema: &Value) -> Result<(), String> {
    validate_data_schema(schema)?;
    if structured::matches(value, schema, 0) {
        Ok(())
    } else {
        Err("BLK-TOOL-SCHEMA".into())
    }
}
impl ProviderHost {
    pub fn model_preflight(&self, root: &Path, request: &GatewayRequest) -> Result<Value, String> {
        Ok(binding::Binding::load(root, request)?.preview(request))
    }
    /// Native confirmation may show the registered destination; it is never returned over IPC.
    pub fn model_destination(
        &self,
        root: &Path,
        request: &GatewayRequest,
        digest: &str,
    ) -> Result<String, String> {
        let bound = binding::Binding::load(root, request)?;
        if bound.digest != digest {
            return Err("BLK-PERM-001".into());
        }
        Ok(bound
            .endpoint
            .as_ref()
            .map(|url| url.to_string())
            .unwrap_or_else(|| "Blocky 本机托管模型".into()))
    }
    pub fn model_call(
        &self,
        root: PathBuf,
        request: GatewayRequest,
        digest: &str,
    ) -> Result<Value, String> {
        let bound = binding::Binding::load(&root, &request)?;
        if bound.digest != digest {
            return Err("BLK-PERM-001".into());
        }
        let active = self.begin(&request.request_id)?;
        execute(
            &root,
            &request,
            &bound,
            &active.cancel,
            &mut || Ok(()),
            &mut |_| {},
        )
    }
}
pub(crate) fn execute(
    root: &Path,
    request: &GatewayRequest,
    bound: &binding::Binding,
    cancel: &std::sync::atomic::AtomicBool,
    before_send: &mut dyn FnMut() -> Result<(), String>,
    observe: &mut dyn FnMut(&[u8]),
) -> Result<Value, String> {
    execute_stream(root, request, bound, cancel, before_send, observe, None)
}
pub(crate) fn execute_stream(
    root: &Path, request: &GatewayRequest, bound: &binding::Binding,
    cancel: &std::sync::atomic::AtomicBool,
    before_send: &mut dyn FnMut() -> Result<(), String>, observe: &mut dyn FnMut(&[u8]),
    mut on_delta: Option<&mut dyn FnMut(Value) -> Result<(), String>>,
) -> Result<Value, String> {
    budget::run(cancel, request.timeout_ms, |cancel| {
        let began = Instant::now();
        let cancelled = || {
            if cancel.load(Ordering::SeqCst) {
                Err("BLK-PROVIDER-CANCELLED".into())
            } else {
                Ok(())
            }
        };
        let mut local_session = bound
            .managed
            .as_ref()
            .map(|options| {
                crate::local_models::LocalSession::start(root, &bound.model, options, cancel)
            })
            .transpose()?;
        let output = (|| {
            let endpoint = if let Some(session) = &local_session {
                reqwest::Url::parse(&session.endpoint).map_err(|_| "BLK-MODEL-ENDPOINT")?
            } else {
                bound.endpoint.clone().ok_or("BLK-MODEL-ENDPOINT")?
            };
            let key = local_session
                .as_ref()
                .map(|s| s.key.as_slice())
                .unwrap_or(&bound.key);
            let mut client = reqwest::Client::builder()
                .no_proxy()
                .redirect(reqwest::redirect::Policy::none())
                .connect_timeout(Duration::from_millis(request.timeout_ms.min(10000)));
            if !bound.local {
                let host = endpoint.host_str().ok_or("BLK-MODEL-ENDPOINT")?;
                let addresses = crate::network_policy::resolve(
                    host,
                    endpoint
                        .port_or_known_default()
                        .ok_or("BLK-MODEL-ENDPOINT")?,
                    &cancelled,
                )?;
                client = client.https_only(true).resolve_to_addrs(host, &addresses);
            }
            cancelled()?;
            let remaining = request
                .timeout_ms
                .saturating_sub(began.elapsed().as_millis() as u64);
            if remaining == 0 {
                return Err("BLK-PROVIDER-TIMEOUT".into());
            }
            let client = client
                .timeout(Duration::from_millis(remaining))
                .build()
                .map_err(|_| "BLK-PROVIDER-TRANSPORT")?;
            let streaming = on_delta.is_some();
            let mut body = bound.body(root, request)?;
            if streaming { body["stream"] = true.into(); body["stream_options"] = serde_json::json!({"include_usage":true}); }
            let mut stream = stream::Stream::default();
            let mut chunk = |bytes: &[u8]| {
                if let Some(emit) = on_delta.as_deref_mut() {
                    stream.feed(bytes, emit)?;
                    if let Some(metadata) = stream.metadata_snapshot() { observe(&metadata); }
                    Ok(())
                } else { Ok(()) }
            };
            let bytes = super::transport::exchange_headers_stream_using(
                client,
                endpoint.as_str(),
                &body,
                remaining,
                std::str::from_utf8(key).map_err(|_| "BLK-MODEL-CONFIG")?,
                Some(&bound.headers),
                cancel,
                &mut ||{images::validate(root,request)?;before_send()},
                &mut chunk,
            )?;
            let bytes = if streaming { stream.complete()? } else { bytes };
            observe(&bytes);
            cancelled()?;
            images::validate(root,request)?;
            let mut result = parse_response(&bytes, &request)?;
            result["provider"] = bound.provider.clone().into();
            result["transport"] = if bound.local { "local" } else { "remote" }.into();
            if bound.managed.is_some() {
                result["localInference"] = true.into();
                result["externalApi"] = false.into();
            }
            Ok(result)
        })();
        if let Some(session) = &mut local_session {
            session.close()?;
        }
        output
    })
}
pub fn dispatch(root: PathBuf, value: &Value) -> Result<Value, String> {
    #[derive(serde::Deserialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct Envelope {
        schema_version: String,
        operation: String,
        request: GatewayRequest,
        approval: Option<Approval>,
    }
    #[derive(serde::Deserialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct Approval {
        request_digest: String,
        approved: bool,
    }
    let e: Envelope = serde_json::from_value(value.clone()).map_err(|_| protocol::INVALID)?;
    if e.schema_version != "blocky.project-io/v1alpha1" {
        return Err(protocol::INVALID.into());
    }
    let host = ProviderHost::default();
    let mut preview = host.model_preflight(&root, &e.request)?;
    let digest = preview["requestDigest"]
        .as_str()
        .ok_or(protocol::INVALID)?
        .to_owned();
    let identity = format!("model/{}/{}", e.request.project_id, e.request.request_id);
    match e.operation.as_str() {
        "provider-model-preflight" if e.approval.is_none() => {
            preview["approvalExpiresAt"] =
                crate::approval_ledger::issue(&root.join("approvals"), &identity, &digest)?.into();
            Ok(preview)
        }
        "provider-model-call" => {
            let a = e
                .approval
                .filter(|a| a.approved && a.request_digest == digest)
                .ok_or("BLK-PERM-001")?;
            crate::approval_ledger::consume(&root.join("approvals"), &identity, &a.request_digest)?;
            host.model_call(root, e.request, &digest)
        }
        _ => Err(protocol::INVALID.into()),
    }
}
#[cfg(test)]
mod tests;
