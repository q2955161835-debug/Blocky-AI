//! One installation per process. The client keeps stdin open until completion;
//! cancellation or a disconnected client lets the installer release its TempDir.
use super::*;
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Request {
    schema_version: String,
    operation: String,
    model_id: String,
    backend: String,
    request_id: String,
    source: Option<InstallSource>,
}
fn parse(bytes: &[u8]) -> Result<Request, String> {
    let value = crate::strict_json::parse(bytes).map_err(|_| INVALID)?;
    let r: Request = serde_json::from_value(value).map_err(|_| INVALID)?;
    if r.schema_version != "blocky.project-io/v1alpha1"
        || r.operation != "provider-local-model-install"
        || r.request_id.is_empty()
        || r.request_id.len() > 128
        || !r
            .request_id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"-_.".contains(&b))
    {
        return Err(INVALID.into());
    }
    Ok(r)
}
pub fn main() -> i32 {
    crate::native_session::run(32768, INVALID, |value, cancel| {
        let r = parse(&serde_json::to_vec(&value).map_err(|_| INVALID)?)?;
        let root = crate::profile::cli_root()?;
        install(&root, &r.model_id, &r.backend, r.source.as_ref(), cancel)
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn refuses_other_operations_and_unknown_fields() {
        let mut v = serde_json::json!({"schemaVersion":"blocky.project-io/v1alpha1","operation":"provider-local-model-install","modelId":MODEL_ID,"backend":"cpu","requestId":"test"});
        assert!(parse(v.to_string().as_bytes()).is_ok());
        v["extra"] = true.into();
        assert!(parse(v.to_string().as_bytes()).is_err());
        v.as_object_mut().unwrap().remove("extra");
        v["operation"] = "provider-local-model-remove".into();
        assert!(parse(v.to_string().as_bytes()).is_err());
    }
}
