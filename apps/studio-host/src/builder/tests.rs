use super::*;
fn start() -> BuilderStart {
    let project = json!({"manifest":{"schemaVersion":"blocky.project/v1","projectId":"sample","displayName":"Sample","modules":[{"moduleId":"main","displayName":"Main","purpose":"agent","workspaceRef":"workspaces/main.json","exports":[]}],"resources":[],"appSurfaces":[],"format":{"createdWith":"0.4.0","minimumReaderVersion":"0.4.0"}},"workspaces":{"main":{"blocks":{"languageVersion":0,"blocks":[]}}},"resources":{},"schemas":{},"surfaces":{}});
    serde_json::from_value(json!({"request":{"schemaVersion":"blocky.builder-request/v1","requestId":"explain-empty","projectId":"sample","intent":"explain","prompt":"解释当前选择","moduleId":"main","selection":[],"createSurface":false},"originalJson":project.to_string(),"mode":"deterministic","resourceId":null,"maxTurns":1})).unwrap()
}
#[test]
fn real_sidecar_is_read_only_and_reaped_before_completion() {
    let root = tempfile::tempdir().unwrap();
    let host = BuilderHost::default();
    let s = start();
    let result = host
        .run(root.path().to_owned(), s.clone(), &s.digest().unwrap())
        .unwrap();
    assert_eq!(result["engine"], "pi-agent-core/0.86.0");
    assert_eq!(result["modelApiCalled"], false);
    assert!(result.get("patch").is_none());
    assert!(host.state.lock().unwrap().active.is_empty());
    assert!(host
        .run(root.path().to_owned(), s.clone(), &s.digest().unwrap())
        .is_err());
    host.shutdown().unwrap();
}
#[test]
fn request_and_approval_boundaries_reject_before_launch() {
    let mut s = start();
    s.request.create_surface = true;
    assert!(s.validate().is_err());
    s = start();
    s.max_turns = 5;
    assert!(s.validate().is_err());
    s = start();
    s.request.module_id = "other".into();
    assert!(s.validate().is_err());
    s = start();
    let root = tempfile::tempdir().unwrap();
    assert!(BuilderHost::default()
        .run(root.path().to_owned(), s, "forged")
        .is_err());
}
#[test]
fn rejects_credentials_before_sidecar() {
    for text in [
        format!("sk-{}", "a".repeat(32)),
        format!("ghp_{}", "a".repeat(36)),
        format!("github_pat_{}", "a".repeat(30)),
        format!("AKIA{}", "A".repeat(16)),
        format!("xoxb-{}", "a".repeat(24)),
        "-----BEGIN PRIVATE KEY-----".into(),
    ] {
        let mut s = start();
        s.request.prompt = text;
        assert_eq!(s.validate().unwrap_err(), "BLK-BUILDER-001");
    }
}

#[test]
fn approval_binds_model_provider_and_secret_reference() {
    let s = start();
    let b: crate::provider::ProviderRequest = serde_json::from_value(json!({"schemaVersion":"blocky.provider-request/v1","requestId":"r1","projectId":"p1","resourceId":"m1","secretRef":"s1","modelId":"deepseek-v4-pro","provider":"xirang","messages":[{"role":"user","content":"public fixture"}],"maxOutputTokens":1024,"timeoutMs":500})).unwrap();
    let digest = approval_digest(&s, Some(&b)).unwrap();
    assert_ne!(digest, s.digest().unwrap());
    for field in ["provider", "modelId", "secretRef"] {
        let mut value = serde_json::to_value(&b).unwrap();
        value[field] = json!(if field == "provider" {
            "deepseek"
        } else {
            "changed"
        });
        let changed = serde_json::from_value(value).unwrap();
        assert_ne!(digest, approval_digest(&s, Some(&changed)).unwrap());
    }
    assert_eq!(approval_digest(&s, None).unwrap(), s.digest().unwrap());
}
