use super::*;
use serde_json::{Value, json};
fn string<'a>(v: &'a Value, key: &str) -> Result<&'a str, String> {
    v[key].as_str().ok_or_else(|| INVALID.into())
}
fn optional<'a>(v: &'a Value, key: &str) -> Result<Option<&'a str>, String> {
    v.get(key)
        .map(|v| v.as_str().ok_or_else(|| INVALID.into()))
        .transpose()
}
pub fn dispatch(store: &ConversionStore, request: &Value) -> Result<Value, String> {
    let op = string(request, "operation")?;
    let fields: &[&str] = match op {
        "conversion-scan" => &["path", "ref", "subdir"],
        "conversion-read" => &["artifactId", "cursor"],
        "conversion-cache-load" => &["snapshotId"],
        "conversion-cache-save" => &["snapshotId", "value", "analysisCache"],
        "conversion-cancel" => &[],
        _ => return Err(INVALID.into()),
    };
    let object = request.as_object().ok_or(INVALID)?;
    if object.keys().any(|key| {
        !["schemaVersion", "operation", "projectId"].contains(&key.as_str())
            && !fields.contains(&key.as_str())
    }) {
        return Err(INVALID.into());
    }
    let project = string(request, "projectId")?;
    let result = match op {
        "conversion-scan" => store.scan(
            project,
            string(request, "path")?,
            optional(request, "ref")?,
            optional(request, "subdir")?,
        ),
        "conversion-read" => {
            let cursor = request
                .get("cursor")
                .map(|v| {
                    v.as_u64()
                        .and_then(|n| usize::try_from(n).ok())
                        .ok_or(INVALID)
                })
                .transpose()?
                .unwrap_or(0);
            store.read(project, string(request, "artifactId")?, cursor)
        }
        "conversion-cache-load" => store.cache_load(project, string(request, "snapshotId")?),
        "conversion-cache-save" => store.cache_save(
            project,
            string(request, "snapshotId")?,
            request.get("value").ok_or(INVALID)?,
            request.get("analysisCache"),
        ),
        "conversion-cancel" => store.cancel(project).map(|_| json!({"cancelled":true})),
        _ => Err(INVALID.into()),
    };
    result.map_err(map_error)
}
