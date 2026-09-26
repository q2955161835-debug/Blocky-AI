use blocky_studio::{project_store, strict_json};
use serde::Deserialize;
use serde_json::{Value, json};
use std::io::{BufRead, Read, Write};
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
    state_kind: Option<String>,
    state_id: Option<String>,
    state_value: Option<Value>,
    variable: Option<String>,
}
fn execute(bytes: &[u8]) -> Value {
    let Ok(value) = strict_json::parse(bytes) else {
        return json!({"ok":false,"code":"BLK-CLI-002"});
    };
    execute_value(value)
}
fn execute_value(value: Value) -> Value {
    if let Err(code) = blocky_studio::profile::from_environment() { return json!({"ok":false,"code":code}); }
    if matches!(value["operation"].as_str(), Some("workflow-list" | "workflow-show")) {
        let result = blocky_studio::profile::cli_root().and_then(|root| blocky_studio::workflow::query::dispatch(root.join("workflow"), &value));
        return match result { Ok(value) => json!({"ok":true,"value":value}), Err(code) => json!({"ok":false,"code":code}) };
    }
    if matches!(value["operation"].as_str(),Some("rpa-captures"|"rpa-capture-read"|"rpa-capture-delete")) {
        let result=blocky_studio::profile::cli_root().and_then(|root|blocky_studio::rpa::captures::dispatch(root.join("rpa/captures"),value));
        return match result {Ok(value)=>json!({"ok":true,"value":value}),Err(code)=>json!({"ok":false,"code":code})};
    }
    if value["operation"] == "profile-info" {
        if value["schemaVersion"] != SCHEMA || value.as_object().is_none_or(|v|v.len()!=2) { return json!({"ok":false,"code":"BLK-CLI-002"}); }
        return match blocky_studio::profile::cli_root() {
            Ok(root) => json!({"ok":true,"value":{"profileId":blocky_studio::profile::identity(&root),"custom":std::env::var_os(blocky_studio::profile::VARIABLE).is_some()}}),
            Err(code) => json!({"ok":false,"code":code}),
        };
    }
    if matches!(value["operation"].as_str(), Some("rpa-checkpoints" | "rpa-checkpoint" | "rpa-recovery-preview" | "rpa-checkpoint-delete")) {
        let result = blocky_studio::rpa::journal::local_root()
            .and_then(|root| blocky_studio::rpa::journal::dispatch(root, value));
        return match result { Ok(value) => json!({"ok":true,"value":value}), Err(code) => json!({"ok":false,"code":code}) };
    }
    if value["operation"]=="rpa-targets" {
        if value["schemaVersion"]!=SCHEMA || value.as_object().is_none_or(|v|v.len()!=2) {return json!({"ok":false,"code":"BLK-CLI-002"});}
        return json!({"ok":true,"value":blocky_studio::rpa::target::list_details()});
    }
    if value["operation"].as_str().is_some_and(|s|s.starts_with("builder-")) {
        let result=blocky_studio::profile::cli_root().and_then(|root|blocky_studio::builder::dispatch(root,&value));
        return match result {Ok(value)=>json!({"ok":true,"value":value}),Err(code)=>json!({"ok":false,"code":code})};
    }
    if value["operation"]
        .as_str()
        .is_some_and(|s| s.starts_with("agent-"))
    {
        let result = blocky_studio::profile::cli_root()
            .and_then(|root| {
                blocky_studio::agent_data::dispatch(
                    root.join("user/agent-memory"),
                    &value,
                )
            });
        return match result {
            Ok(value) => json!({"ok":true,"value":value}),
            Err(code) => json!({"ok":false,"code":code}),
        };
    }
    if value["operation"]
        .as_str()
        .is_some_and(|s| s.starts_with("provider-"))
    {
        let result = blocky_studio::profile::cli_root()
            .and_then(|root| {
                blocky_studio::provider::dispatch(root, &value)
            });
        return match result {
            Ok(value) => json!({"ok":true,"value":value}),
            Err(code) => json!({"ok":false,"code":code}),
        };
    }
    if value["operation"]
        .as_str()
        .is_some_and(|operation| operation.starts_with("conversion-"))
    {
        if value["schemaVersion"] != SCHEMA {
            return json!({"ok":false,"code":"BLK-MIG-001"});
        }
        let result = blocky_studio::profile::cli_root()
            .and_then(|root| {
                let store = blocky_studio::conversion::ConversionStore::new(
                    root.join("conversion"),
                );
                blocky_studio::conversion::dispatch(&store, &value)
            });
        return match result {
            Ok(value) => {
                let mut response = json!({"ok":true});
                response["value"] = value;
                response
            }
            Err(code) => json!({"ok":false,"code":code}),
        };
    }
    if value["operation"]
        .as_str()
        .is_some_and(|s| s.starts_with("knowledge-"))
    {
        if value["schemaVersion"] != SCHEMA {
            return json!({"ok":false,"code":"BLK-MIG-001"});
        }
        let result = blocky_studio::profile::cli_root()
            .and_then(|root| {
                let store = blocky_studio::knowledge::KnowledgeStore::new(
                    root.join("knowledge"),
                );
                blocky_studio::knowledge::dispatch(&store, &value)
            });
        return match result {
            Ok(value) => {
                let mut response = json!({"ok":true});
                response["value"] = value;
                response
            }
            Err(code) => json!({"ok":false,"code":code}),
        };
    }
    let request = serde_json::from_value::<Request>(value);
    let Ok(r) = request else {
        return json!({"ok":false,"code":"BLK-CLI-002"});
    };
    if r.schema_version != SCHEMA {
        return json!({"ok":false,"code":"BLK-MIG-001"});
    }
    if r.operation.starts_with("user-") || r.operation.starts_with("secret-") {
        let result = (|| -> Result<Value, String> {
            if r.files.is_some()
                || r.original_json.is_some()
                || r.patch.is_some()
                || r.approved.is_some()
                || r.source.is_some()
            {
                return Err("BLK-CLI-002".into());
            }
            let root = blocky_studio::profile::cli_root()?;
            let id = r.state_id.as_deref().ok_or("BLK-CLI-002")?;
            if r.operation.starts_with("user-") {
                if r.path.is_some() || r.variable.is_some() {
                    return Err("BLK-CLI-002".into());
                }
                let kind = r.state_kind.as_deref().ok_or("BLK-CLI-002")?;
                if !["settings", "shortcuts", "resources"].contains(&kind) {
                    return Err("BLK-PERM-001".into());
                }
                let store = blocky_studio::user_store::UserStore::new(root.join("user"));
                return match r.operation.as_str() {
                    "user-read" if r.state_value.is_none() => {
                        Ok(json!({"ok":true,"value":store.read(kind,id)?}))
                    }
                    "user-write" => {
                        store.write(kind, id, r.state_value.clone().ok_or("BLK-CLI-002")?)?;
                        Ok(json!({"ok":true}))
                    }
                    _ => Err("BLK-CLI-002".into()),
                };
            }
            if r.state_kind.is_some() || r.state_value.is_some() {
                return Err("BLK-CLI-002".into());
            }
            let store = blocky_studio::secret_store::SecretStore::new(root.join("secrets"));
            match r.operation.as_str() {
                "secret-import" => {
                    store.import_env(
                        id,
                        Path::new(r.path.as_deref().ok_or("BLK-CLI-002")?),
                        r.variable.as_deref().ok_or("BLK-CLI-002")?,
                    )?;
                    Ok(json!({"ok":true,"value":true}))
                }
                "secret-status" if r.path.is_none() && r.variable.is_none() => {
                    Ok(json!({"ok":true,"value":store.contains(id)?}))
                }
                "secret-remove" if r.path.is_none() && r.variable.is_none() => {
                    store.remove(id)?;
                    Ok(json!({"ok":true}))
                }
                _ => Err("BLK-CLI-002".into()),
            }
        })();
        return result.unwrap_or_else(|code| json!({"ok":false,"code":code}));
    }
    if r.state_kind.is_some()
        || r.state_id.is_some()
        || r.state_value.is_some()
        || r.variable.is_some()
    {
        return json!({"ok":false,"code":"BLK-CLI-002"});
    }
    if r.operation == "validate-patch" || r.operation == "apply-patch" {
        let result = (|| -> Result<Value, String> {
            if r.files.is_some() {
                return Err("BLK-CLI-002".into());
            }
            let original = r.original_json.as_deref().ok_or("BLK-CLI-002")?;
            let root = blocky_studio::profile::cli_root()?;
            let store =
                blocky_studio::user_store::UserStore::new(root.join("user"));
            let registry = store.read("resources", "app")?.unwrap_or(Value::Null);
            let next = blocky_studio::patch_guard::validate_with_registry(
                original,
                r.patch.as_ref().ok_or("BLK-CLI-002")?,
                r.approved.as_deref().ok_or("BLK-CLI-002")?,
                &registry,
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
                        let found = actual.get(key).ok_or("BLK-PATCH-001")?;
                        let equal = if key.ends_with(".json") {
                            strict_json::parse(found.as_bytes())?
                                == strict_json::parse(value.as_bytes())?
                        } else {
                            found == value
                        };
                        if !equal {
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
        ("version", None, None) => json!({"ok":true,"version":env!("CARGO_PKG_VERSION")}),
        ("read", Some(path), None) => match project_store::read_archive(Path::new(&path)) {
            Ok(files) => json!({"ok":true,"files":files}),
            Err(_) => json!({"ok":false,"code":"BLK-LOAD-001"}),
        },
        ("read-migration", Some(path), None) => {
            match project_store::read_migration_archive(Path::new(&path)) {
                Ok(files) => json!({"ok":true,"files":files}),
                Err(_) => json!({"ok":false,"code":"BLK-MIG-001"}),
            }
        }
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
    match std::env::args().nth(1).as_deref() {
        Some("--blocky-rpa-worker") => std::process::exit(blocky_studio::rpa::worker_main()),
        Some("--blocky-rpa-recording-worker") => std::process::exit(blocky_studio::rpa::recording::worker_main()),
        Some("--blocky-rpa-record") => std::process::exit(blocky_studio::rpa::recording::session_main()),
        Some("--blocky-rpa-run") => std::process::exit(blocky_studio::rpa::runner_main()),
        Some("--blocky-rpa-module") => std::process::exit(blocky_studio::rpa::module_session_main()),
        Some("--blocky-task-worker") => std::process::exit(blocky_studio::task_host::worker_main()),
        Some("--blocky-task-run") => std::process::exit(blocky_studio::task_host::runner_main()),
        Some("--blocky-knowledge-session") => std::process::exit(knowledge_session()),
        _ => {}
    }
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
fn knowledge_session() -> i32 {
    const MAX: u64 = 384 * 1024 * 1024;
    let mut input = std::io::stdin().lock();
    let mut output = std::io::stdout().lock();
    loop {
        let mut bytes = Vec::new();
        let read = Read::by_ref(&mut input)
            .take(MAX + 1)
            .read_until(b'\n', &mut bytes);
        if matches!(read, Ok(0)) {
            return 0;
        }
        let oversized = read.is_err() || bytes.len() as u64 > MAX;
        let mut response = if oversized {
            json!({"ok":false,"code":"BLK-KNOW-LIMIT"})
        } else {
            match strict_json::parse(&bytes) {
                Ok(value)
                    if value["operation"]
                        .as_str()
                        .is_some_and(|op| op.starts_with("knowledge-")) =>
                {
                    drop(bytes);
                    execute_value(value)
                }
                _ => json!({"ok":false,"code":"BLK-CLI-002"}),
            }
        };
        response["schemaVersion"] = SCHEMA.into();
        if writeln!(output, "{}", response).is_err() || output.flush().is_err() {
            return 3;
        }
        if oversized {
            return 3;
        }
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
