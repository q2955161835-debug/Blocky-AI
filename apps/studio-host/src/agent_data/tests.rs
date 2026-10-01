use super::*;
pub(super) fn fixture() -> (tempfile::TempDir, AgentData) {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../try/stage4/agent-data-tests");
    std::fs::create_dir_all(&root).unwrap();
    let tmp = tempfile::tempdir_in(root).unwrap();
    let host = AgentData::new(tmp.path().join("memory"));
    (tmp, host)
}
fn request(action: &str, value: Option<Value>) -> MemoryRequest {
    MemoryRequest {
        request_id: "memory-request".into(),
        project_id: "project-one".into(),
        session_id: "run-one".into(),
        scope: "project".into(),
        key: "greeting".into(),
        action: action.into(),
        value,
    }
}
fn tool() -> ToolRequest {
    ToolRequest {
        schema_version: "blocky.tool-request/v1".into(),
        project_id: "project-one".into(),
        run_id: "run-one".into(),
        request_id: "request-one".into(),
        tool_id: "text.analyze/v1".into(),
        input: "hello 世界\nsecond line".into(),
    }
}
#[test]
fn memory_roundtrip_delete_and_reload() {
    let (tmp, host) = fixture();
    let token = host.authorize("project-one", "run-one").unwrap();
    let null_request:MemoryRequest=serde_json::from_value(json!({"requestId":"null-memory","projectId":"project-one","sessionId":"run-one","scope":"project","key":"nullable","action":"write","value":null})).unwrap();
    host.memory(&token, &null_request).unwrap();
    assert_eq!(
        host.memory(&token, &request("read", None)).unwrap()["found"],
        false
    );
    host.memory(&token, &request("write", Some(json!({"value":"fixture"}))))
        .unwrap();
    let fresh = AgentData::new(tmp.path().join("memory"));
    let t = fresh.authorize("project-one", "run-two").unwrap();
    let mut r = request("read", None);
    r.session_id = "run-two".into();
    assert_eq!(fresh.memory(&t, &r).unwrap()["value"]["value"], "fixture");
    host.memory(&token, &request("delete", None)).unwrap();
    assert_eq!(fresh.memory(&t, &r).unwrap()["found"], false);
}
#[test]
fn forged_cross_project_expired_revoked_and_stopped_grants_do_not_write() {
    let (_tmp, host) = fixture();
    let token = host.authorize("project-one", "run-one").unwrap();
    let r = request("write", Some(json!("fixture")));
    assert_eq!(host.memory("forged", &r).unwrap_err(), PERMISSION);
    let mut cross = r.clone();
    cross.project_id = "project-two".into();
    assert_eq!(host.memory(&token, &cross).unwrap_err(), PERMISSION);
    cross = r.clone();
    cross.session_id = "run-two".into();
    assert_eq!(host.memory(&token, &cross).unwrap_err(), PERMISSION);
    host.state
        .lock()
        .unwrap()
        .grants
        .get_mut(&token)
        .unwrap()
        .lifetime = Duration::ZERO;
    assert_eq!(host.memory(&token, &r).unwrap_err(), PERMISSION);
    let token = host.authorize("project-one", "run-one").unwrap();
    host.revoke(&token).unwrap();
    assert_eq!(host.memory(&token, &r).unwrap_err(), PERMISSION);
    let token = host.authorize("project-one", "run-one").unwrap();
    host.shutdown().unwrap();
    assert_eq!(host.memory(&token, &r).unwrap_err(), PERMISSION);
    assert!(!host.root.exists());
}
#[test]
fn quotas_paths_and_session_scope_fail_without_partial_commit() {
    let (_tmp, host) = fixture();
    let token = host.authorize("project-one", "run-one").unwrap();
    let mut r = request("write", Some(json!("x".repeat(32769))));
    assert_eq!(host.memory(&token, &r).unwrap_err(), "BLK-AGENT-LIMIT");
    r = request("write", Some(json!("preserve")));
    host.memory(&token, &r).unwrap();
    for key in ["../escape", "C:\\file", "bad/key"] {
        r.key = key.into();
        assert!(host.memory(&token, &r).is_err());
    }
    r = request("write", Some(json!("x".repeat(32760))));
    let mut limited = false;
    for n in 0..40 {
        r.key = format!("key-{n}");
        if host.memory(&token, &r).is_err() {
            limited = true;
            break;
        }
    }
    assert!(limited);
    assert_eq!(
        host.memory(&token, &request("read", None)).unwrap()["value"],
        "preserve"
    );
    r = request("read", None);
    r.scope = "session".into();
    assert!(host.memory(&token, &r).is_err());
    assert!(std::fs::read_dir(&host.root).unwrap().all(|entry| {
        let name = entry.unwrap().file_name();
        name == "project-one.json" || name == "memory.lock"
    }));
}
#[test]
fn tool_digest_replay_cancel_and_scope_are_enforced() {
    let (_tmp, host) = fixture();
    let r = tool();
    let d = digest(&r).unwrap();
    assert_eq!(host.tool(&r, "wrong").unwrap_err(), PERMISSION);
    let mut edited = r.clone();
    edited.input.push('!');
    assert_eq!(host.tool(&edited, &d).unwrap_err(), PERMISSION);
    let answer = host.tool(&r, &d).unwrap();
    assert_eq!(answer, json!({"characters":20,"lines":2,"words":4}));
    assert_eq!(host.tool(&r, &d).unwrap_err(), PERMISSION);
    let mut cancelled = tool();
    cancelled.request_id = "cancelled".into();
    host.cancel_tool(&cancelled.request_id).unwrap();
    assert_eq!(
        host.tool(&cancelled, &digest(&cancelled).unwrap())
            .unwrap_err(),
        PERMISSION
    );
    let mut invalid = tool();
    invalid.tool_id = "shell/v1".into();
    assert!(host.tool(&invalid, &digest(&invalid).unwrap()).is_err());
}
#[test]
fn cli_approval_is_exact_and_never_default() {
    let (_tmp, host) = fixture();
    let r = request("write", Some(json!("fixture")));
    let mut v = json!({"schemaVersion":"blocky.project-io/v1alpha1","operation":"agent-memory","request":r});
    assert_eq!(dispatch(host.root.clone(), &v).unwrap_err(), PERMISSION);
    v["approval"] = json!({"approved":true,"requestDigest":digest(&r).unwrap()});
    dispatch(host.root.clone(),&json!({"schemaVersion":"blocky.project-io/v1alpha1","operation":"agent-memory-preflight","request":r})).unwrap();
    assert_eq!(dispatch(host.root.clone(), &v).unwrap()["ok"], true);
    assert_eq!(dispatch(host.root.clone(), &v).unwrap_err(), PERMISSION);
    assert_eq!(dispatch(host.root.clone(),&json!({"schemaVersion":"blocky.project-io/v1alpha1","operation":"agent-memory-preflight","request":r})).unwrap_err(),PERMISSION);
    v["request"]["projectId"] = json!("changed-project");
    assert_eq!(dispatch(host.root.clone(), &v).unwrap_err(), PERMISSION);
    let mut pre = json!({"schemaVersion":"blocky.project-io/v1alpha1","operation":"agent-tool-preflight","request":tool()});
    assert!(dispatch(host.root.clone(), &pre).unwrap()["requestDigest"].is_string());
    pre["arbitraryPath"] = json!("bad");
    assert_eq!(dispatch(host.root.clone(), &pre).unwrap_err(), INVALID);
}
#[test]
fn cli_tool_approval_is_single_use_across_host_instances() {
    let (_tmp, host) = fixture();
    let r = tool();
    let pre = json!({"schemaVersion":"blocky.project-io/v1alpha1","operation":"agent-tool-preflight","request":r});
    let preview = dispatch(host.root.clone(), &pre).unwrap();
    let call = json!({"schemaVersion":"blocky.project-io/v1alpha1","operation":"agent-tool","request":r,"approval":{"approved":true,"requestDigest":preview["requestDigest"]}});
    assert_eq!(dispatch(host.root.clone(), &call).unwrap()["words"], 4);
    assert_eq!(dispatch(host.root.clone(), &call).unwrap_err(), PERMISSION);
    assert_eq!(dispatch(host.root.clone(), &pre).unwrap_err(), PERMISSION);
}
