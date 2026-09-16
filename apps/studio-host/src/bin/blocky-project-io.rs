use blocky_studio::{project_store, strict_json};
use serde::Deserialize;
use serde_json::{Value, json};
use std::io::{Read, Write};
use std::path::Path;
const SCHEMA: &str = "blocky.project-io/v1alpha1";
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Request {
    schema_version: String,
    operation: String,
    path: Option<String>,
    files: Option<project_store::ProjectFiles>,
    #[serde(rename = "originalJson")]
    original_json: Option<String>,
    patch: Option<Value>,
    approved: Option<Vec<String>>,
    source: Option<String>,
}
fn execute(bytes: &[u8]) -> Value {
    let request = strict_json::parse(bytes)
        .and_then(|v| serde_json::from_value::<Request>(v).map_err(|_| "BLK-CLI-002".into()));
    let Ok(r) = request else {
        return json!({"ok":false,"code":"BLK-CLI-002"});
    };
    if r.schema_version != SCHEMA {
        return json!({"ok":false,"code":"BLK-MIG-001"});
    }
    if r.operation == "validate-patch" || r.operation == "apply-patch" {
        let result = (|| -> Result<Value, String> {
            if r.files.is_some() {
                return Err("BLK-CLI-002".into());
            }
            let original = r.original_json.as_deref().ok_or("BLK-CLI-002")?;
            let next = blocky_studio::patch_guard::validate(
                original,
                r.patch.as_ref().ok_or("BLK-CLI-002")?,
                r.approved.as_deref().ok_or("BLK-CLI-002")?,
            )?;
            if r.operation == "apply-patch" {
                let source = Path::new(r.source.as_deref().ok_or("BLK-CLI-002")?);
                let original_value = strict_json::parse(original.as_bytes())?;
                let expected = blocky_studio::patch_guard::project_files(&original_value)?;
                let check = || -> Result<(), String> {
                    let actual = project_store::read_archive(source)?;
                    if actual.len() != expected.len() {
                        return Err("BLK-PATCH-001".into());
                    }
                    for (key, value) in &expected {
                        if strict_json::parse(actual.get(key).ok_or("BLK-PATCH-001")?.as_bytes())?
                            != strict_json::parse(value.as_bytes())?
                        {
                            return Err("BLK-PATCH-001".into());
                        }
                    }
                    Ok(())
                };
                check()?;
                let files = blocky_studio::patch_guard::project_files(&next)?;
                project_store::create_archive_checked(
                    Path::new(r.path.as_deref().ok_or("BLK-CLI-002")?),
                    &files,
                    check,
                )?;
                Ok(json!({"ok":true}))
            } else {
                if r.path.is_some() || r.source.is_some() {
                    return Err("BLK-CLI-002".into());
                }
                Ok(json!({"ok":true,"project":next}))
            }
        })();
        return result.unwrap_or_else(|code| json!({"ok":false,"code":code}));
    }
    if r.original_json.is_some() || r.patch.is_some() || r.approved.is_some() || r.source.is_some()
    {
        return json!({"ok":false,"code":"BLK-CLI-002"});
    }
    match (r.operation.as_str(), r.path, r.files) {
        ("version", None, None) => json!({"ok":true,"version":"0.1.0"}),
        ("read", Some(path), None) => match project_store::read_archive(Path::new(&path)) {
            Ok(files) => json!({"ok":true,"files":files}),
            Err(_) => json!({"ok":false,"code":"BLK-LOAD-001"}),
        },
        ("create", Some(path), Some(files)) => {
            match project_store::create_archive(Path::new(&path), &files) {
                Ok(()) => json!({"ok":true}),
                Err(code) => json!({"ok":false,"code":code}),
            }
        }
        _ => json!({"ok":false,"code":"BLK-CLI-002"}),
    }
}
fn main() {
    let mut bytes = Vec::new();
    let input = std::io::stdin()
        .take(20 * 1024 * 1024 + 1)
        .read_to_end(&mut bytes);
    let mut response = if input.is_err() || bytes.len() > 20 * 1024 * 1024 {
        json!({"ok":false,"code":"BLK-REF-001"})
    } else {
        execute(&bytes)
    };
    response["schemaVersion"] = SCHEMA.into();
    let ok = response["ok"] == true;
    let _ = writeln!(std::io::stdout(), "{}", response);
    if !ok {
        std::process::exit(3);
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_unknown_protocol_and_undeclared_arguments() {
        assert_eq!(
            execute(br#"{"schemaVersion":"future","operation":"version"}"#)["ok"],
            false
        );
        assert_eq!(execute(br#"{"schemaVersion":"blocky.project-io/v1alpha1","operation":"version","path":"unexpected"}"#)["ok"],false);
        assert_eq!(
            execute(br#"{"schemaVersion":"blocky.project-io/v1alpha1","operation":"version"}"#)["ok"],
            true
        );
    }
}
