
use super::*;
use serde_json::{Value, json};
use std::time::Duration;
fn registry() -> Value {
    json!({"schemaVersion":"blocky.resource-registry/v2","revision":1,
      "providers":[{"schemaVersion":"blocky.model-provider/v1","providerId":"shared","displayName":"Shared","adapter":"ollama","protocol":"openai-chat","revision":1,"secretBindings":[{"fieldId":"baseUrl","secretRef":"endpoint1"}]}],
      "resources":[{"schemaVersion":"blocky.resource/v1alpha1","resourceId":"model1","kind":"model","scope":"user","displayName":"Model one","capabilityRequirements":[],"definition":{"connectionRef":"shared","modelId":"small:latest","timeoutMs":30000,"capabilities":["text","tools"]},"secretBindings":[]}]})
}
fn profile() -> tempfile::TempDir {
    let p = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../try/model-providers/host-tests");
    std::fs::create_dir_all(&p).unwrap();
    tempfile::tempdir_in(p).unwrap()
}
#[test]
fn resolves_only_declared_connections_and_rejects_overrides() {
    let r = registry();
    let m = resolve_resource(&r, "model1").unwrap();
    assert_eq!(m["definition"]["provider"], "ollama");
    assert_eq!(m["definition"]["connectionRevision"], 1);
    assert_eq!(m["secretBindings"][0]["secretRef"], "endpoint1");
    for field in ["provider", "protocol", "baseUrl", "connectionRevision"] {
        let mut bad = r.clone();
        bad["resources"][0]["definition"][field] = json!("forged");
        assert!(validate_registry(&bad).is_err());
    }
    let mut bad = r.clone();
    bad["providers"][0]["protocol"] = json!("unknown");
    assert!(validate_registry(&bad).is_err());
    let mut bad = r.clone();
    bad["providers"] = json!([]);
    assert!(validate_registry(&bad).is_err());
}
#[test]
fn migration_write_cas_backup_and_explicit_rollback_preserve_state() {
    let temp = profile();
    let root = temp.path().join("user");
    let store = crate::user_store::UserStore::new(root.clone());
    let old = json!({"schemaVersion":"blocky.resource-registry/v1","resources":[]});
    store.write("resources", "app", old.clone()).unwrap();
    store.write("resources", "app", registry()).unwrap();
    assert_eq!(
        store.read("resources", "app.v1-backup").unwrap(),
        Some(old.clone())
    );
    assert_eq!(
        store.write("resources", "app", registry()).unwrap_err(),
        "BLK-RESOURCE-CONFLICT"
    );
    let mut invalid = registry();
    invalid["revision"] = json!(2);
    invalid["providers"] = json!([]);
    assert!(store.write("resources", "app", invalid).is_err());
    assert_eq!(store.read("resources", "app").unwrap(), Some(registry()));
    rollback(&root, 1).unwrap();
    assert_eq!(store.read("resources", "app").unwrap(), Some(old));
}
#[test]
fn provider_edits_require_a_new_connection_revision() {
    let temp = profile();
    let store = crate::user_store::UserStore::new(temp.path().join("user"));
    store.write("resources", "app", registry()).unwrap();
    let mut bad = registry();
    bad["revision"] = json!(2);
    bad["providers"][0]["displayName"] = json!("Updated");
    assert_eq!(
        store.write("resources", "app", bad.clone()).unwrap_err(),
        "BLK-RESOURCE-CONFLICT"
    );
    bad["providers"][0]["revision"] = json!(2);
    store.write("resources", "app", bad).unwrap();
}
#[test]
fn simultaneous_stores_cannot_silently_overwrite_each_other() {
    let temp = profile();
    let root = temp.path().join("user");
    crate::user_store::UserStore::new(root.clone())
        .write("resources", "app", registry())
        .unwrap();
    let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
    let mut handles = vec![];
    for n in 0..2 {
        let root = root.clone();
        let b = barrier.clone();
        let mut value = registry();
        value["revision"] = json!(2);
        value["providers"][0]["revision"] = json!(2);
        value["providers"][0]["displayName"] = json!(format!("New {n}"));
        handles.push(std::thread::spawn(move || {
            b.wait();
            crate::user_store::UserStore::new(root).write("resources", "app", value)
        }));
    }
    let results: Vec<_> = handles.into_iter().map(|h| h.join().unwrap()).collect();
    assert_eq!(results.iter().filter(|r| r.is_ok()).count(), 1);
}
#[test]
fn changing_shared_connection_and_secret_versions_invalidates_gateway_approvals() {
    let temp = profile();
    let root = temp.path();
    let env = root.join("fixture.env");
    std::fs::write(&env, "ENDPOINT=http://127.0.0.1:11434/v1\n").unwrap();
    crate::secret_store::SecretStore::new(root.join("secrets"))
        .import_env("endpoint1", &env, "ENDPOINT")
        .unwrap();
    let store = crate::user_store::UserStore::new(root.join("user"));
    store.write("resources", "app", registry()).unwrap();
    let req:crate::provider::gateway::GatewayRequest=serde_json::from_value(json!({"schemaVersion":"blocky.model-request/v2","requestId":"one","projectId":"project1","resourceId":"model1","messages":[{"role":"user","content":"Hello"}],"maxOutputTokens":16,"timeoutMs":30000})).unwrap();
    let host = crate::provider::ProviderHost::default();
    let first = host.model_preflight(root, &req).unwrap();
    let mut next = registry();
    next["revision"] = json!(2);
    next["providers"][0]["revision"] = json!(2);
    store.write("resources", "app", next).unwrap();
    assert_ne!(
        first["requestDigest"],
        host.model_preflight(root, &req).unwrap()["requestDigest"]
    );
    assert_eq!(
        host.model_call(
            root.to_owned(),
            req.clone(),
            first["requestDigest"].as_str().unwrap()
        )
        .unwrap_err(),
        "BLK-PERM-001"
    );
    std::fs::write(&env, "ENDPOINT=http://127.0.0.1:11435/v1\n").unwrap();
    let before = host.model_preflight(root, &req).unwrap();
    crate::secret_store::SecretStore::new(root.join("secrets"))
        .import_env("endpoint1", &env, "ENDPOINT")
        .unwrap();
    assert_ne!(
        before["requestDigest"],
        host.model_preflight(root, &req).unwrap()["requestDigest"]
    );
}
#[test]
fn connected_deepseek_builder_preflight_is_bound_to_connection_revision() {
    let temp = profile();
    let root = temp.path();
    let env = root.join("fixture.env");
    std::fs::write(&env, "KEY=synthetic-test-only\n").unwrap();
    crate::secret_store::SecretStore::new(root.join("secrets"))
        .import_env("key1", &env, "KEY")
        .unwrap();
    let mut r = registry();
    r["providers"][0]["adapter"] = json!("deepseek");
    r["providers"][0]["secretBindings"] = json!([{"fieldId":"apiKey","secretRef":"key1"}]);
    r["resources"][0]["definition"]["timeoutMs"] = json!(60000);
    let store = crate::user_store::UserStore::new(root.join("user"));
    store.write("resources", "app", r.clone()).unwrap();
    let project = json!({"manifest":{"schemaVersion":"blocky.project/v1","projectId":"sample","displayName":"Sample","modules":[{"moduleId":"main","displayName":"Main","purpose":"agent","workspaceRef":"workspaces/main.json","exports":[]}],"resources":[],"appSurfaces":[],"format":{"createdWith":"0.8.0","minimumReaderVersion":"0.8.0"}},"workspaces":{"main":{"blocks":{"languageVersion":0,"blocks":[]}}},"resources":{},"schemas":{},"surfaces":{}});
    let s:crate::builder::BuilderStart=serde_json::from_value(json!({"request":{"schemaVersion":"blocky.builder-request/v1","requestId":"explain-empty","projectId":"sample","intent":"explain","prompt":"解释当前选择","moduleId":"main","selection":[],"createSurface":false},"originalJson":project.to_string(),"mode":"live","resourceId":"model1","maxTurns":1})).unwrap();
    let host = crate::builder::BuilderHost::default();
    let before = host.preflight(root, &s).unwrap();
    r["revision"] = json!(2);
    r["providers"][0]["revision"] = json!(2);
    store.write("resources", "app", r).unwrap();
    assert_ne!(
        before["requestDigest"],
        host.preflight(root, &s).unwrap()["requestDigest"]
    );
    assert_eq!(
        host.destination(root, &s, before["requestDigest"].as_str().unwrap())
            .unwrap_err(),
        "BLK-PERM-001"
    );
}
#[test]
fn two_profiles_send_distinct_models_to_one_shared_local_connection() {
    use std::io::{Read, Write};
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = listener.local_addr().unwrap();
    let temp = profile();
    let root = temp.path();
    let env = root.join("fixture.env");
    std::fs::write(&env, format!("ENDPOINT=http://{addr}/v1\n")).unwrap();
    crate::secret_store::SecretStore::new(root.join("secrets"))
        .import_env("endpoint1", &env, "ENDPOINT")
        .unwrap();
    let mut r = registry();
    let mut second = r["resources"][0].clone();
    second["resourceId"] = json!("model2");
    second["definition"]["modelId"] = json!("other:latest");
    r["resources"].as_array_mut().unwrap().push(second);
    crate::user_store::UserStore::new(root.join("user"))
        .write("resources", "app", r)
        .unwrap();
    let server = std::thread::spawn(move || {
        let mut models = vec![];
        for _ in 0..2 {
            let (mut s, _) = listener.accept().unwrap();
            s.set_read_timeout(Some(Duration::from_secs(3))).unwrap();
            let mut bytes = vec![];
            loop {
                let mut b = [0u8; 8192];
                let n = s.read(&mut b).unwrap();
                assert!(n > 0);
                bytes.extend_from_slice(&b[..n]);
                if let Some(i) = bytes.windows(4).position(|w| w == b"\r\n\r\n") {
                    let head = String::from_utf8_lossy(&bytes[..i]);
                    let len = head
                        .lines()
                        .find_map(|l| {
                            l.to_ascii_lowercase()
                                .strip_prefix("content-length: ")
                                .and_then(|v| v.parse::<usize>().ok())
                        })
                        .unwrap();
                    if bytes.len() >= i + 4 + len {
                        let body: Value =
                            serde_json::from_slice(&bytes[i + 4..i + 4 + len]).unwrap();
                        models.push(body["model"].clone());
                        break;
                    }
                }
            }
            let body=json!({"id":"response-local","model":models.last().unwrap(),"choices":[{"message":{"role":"assistant","content":"ok"},"finish_reason":"stop"}]}).to_string();
            write!(
                s,
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            )
            .unwrap();
        }
        models
    });
    for n in 1..=2 {
        let request:crate::provider::gateway::GatewayRequest=serde_json::from_value(json!({"schemaVersion":"blocky.model-request/v2","requestId":format!("request{n}"),"projectId":"project1","resourceId":format!("model{n}"),"messages":[{"role":"user","content":"Hello"}],"maxOutputTokens":16,"timeoutMs":30000})).unwrap();
        let host = crate::provider::ProviderHost::default();
        let p = host.model_preflight(root, &request).unwrap();
        let result = host
            .model_call(
                root.to_owned(),
                request,
                p["requestDigest"].as_str().unwrap(),
            )
            .unwrap();
        assert_eq!(result["transport"], "local");
        assert_eq!(result["usageStatus"], "unavailable");
    }
    assert_eq!(
        server.join().unwrap(),
        vec![json!("small:latest"), json!("other:latest")]
    );
}
