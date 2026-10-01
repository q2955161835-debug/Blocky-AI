use super::*;
use serde_json::json;
use std::{
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};
fn profile() -> tempfile::TempDir {
    let base = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../try/agent-capability-upgrade/tool-tests");
    std::fs::create_dir_all(&base).unwrap();
    tempfile::tempdir_in(base).unwrap()
}
fn request(id: &str) -> ToolRequest {
    serde_json::from_value(json!({"schemaVersion":"blocky.tool-request/v2","projectId":"project-test","runId":"run-test","requestId":id,"resourceId":"tool-test","action":"call","input":{"text":"three public words"},"timeoutMs":3000})).unwrap()
}
fn resource(root: &Path, endpoint: &str) -> Value {
    let env = root.join("endpoint.env");
    std::fs::write(&env, format!("TOOL_ENDPOINT={endpoint}\n")).unwrap();
    crate::secret_store::SecretStore::new(root.join("secrets"))
        .import_env("tool-endpoint", &env, "TOOL_ENDPOINT")
        .unwrap();
    let registry = json!({"schemaVersion":"blocky.resource-registry/v1","resources":[{"schemaVersion":"blocky.resource/v1alpha1","resourceId":"tool-test","kind":"tool","scope":"user","displayName":"Count words","capabilityRequirements":["network.request"],"definition":{"version":"1","implementationRef":{"kind":"adapter","id":"http-json-v1"},"permissions":["network.request"],"method":"POST","networkMode":"loopback","timeoutMs":3000,"inputSchemaRef":{"kind":"schema","id":"tool-input"},"outputSchemaRef":{"kind":"schema","id":"tool-output"},"inputSchemaJson":json!({"type":"object","properties":{"text":{"type":"string"}},"required":["text"],"additionalProperties":false}).to_string(),"outputSchemaJson":json!({"type":"object","properties":{"words":{"type":"integer"}},"required":["words"],"additionalProperties":false}).to_string()},"secretBindings":[{"fieldId":"endpoint","secretRef":"tool-endpoint"}]}]});
    crate::user_store::UserStore::new(root.join("user"))
        .write("resources", "app", registry.clone())
        .unwrap();
    registry
}
fn server(
    delay: Duration,
    result: Value,
) -> (String, std::thread::JoinHandle<Value>, Arc<AtomicBool>) {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let endpoint = format!("http://{}/count", listener.local_addr().unwrap());
    let received = Arc::new(AtomicBool::new(false));
    let flag = received.clone();
    let task = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(3)))
            .unwrap();
        let mut bytes = Vec::new();
        let mut buffer = [0u8; 4096];
        let body = loop {
            let count = stream.read(&mut buffer).unwrap();
            assert!(count > 0);
            bytes.extend_from_slice(&buffer[..count]);
            if let Some(end) = bytes.windows(4).position(|s| s == b"\r\n\r\n") {
                let header = String::from_utf8_lossy(&bytes[..end]);
                let size = header
                    .lines()
                    .find_map(|line| {
                        line.to_ascii_lowercase()
                            .strip_prefix("content-length: ")
                            .and_then(|s| s.parse::<usize>().ok())
                    })
                    .unwrap();
                if bytes.len() >= end + 4 + size {
                    break serde_json::from_slice::<Value>(&bytes[end + 4..end + 4 + size])
                        .unwrap();
                }
            }
        };
        flag.store(true, Ordering::SeqCst);
        std::thread::sleep(delay);
        let body_text = result.to_string();
        let _=write!(stream,"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",body_text.len(),body_text);
        body
    });
    (endpoint, task, received)
}
fn envelope(operation: &str, r: &ToolRequest) -> Value {
    json!({"schemaVersion":"blocky.project-io/v1alpha1","operation":operation,"request":r})
}
#[test]
fn approved_http_call_returns_actual_json_and_cannot_replay() {
    let root = profile();
    let (endpoint, server, _) = server(Duration::ZERO, json!({"words":3}));
    resource(root.path(), &endpoint);
    let r = request("http-success");
    let cancel = AtomicBool::new(false);
    let preview = dispatch::execute(root.path(), &envelope("tool-preflight", &r), &cancel).unwrap();
    assert!(!preview.to_string().contains("127.0.0.1"));
    let mut call = envelope("tool-call", &r);
    call["approval"] = json!({"approved":true,"requestDigest":preview["requestDigest"]});
    assert_eq!(
        dispatch::execute(root.path(), &call, &cancel).unwrap(),
        json!({"words":3})
    );
    assert_eq!(server.join().unwrap(), r.input);
    assert!(dispatch::execute(root.path(), &call, &cancel).is_err());
    // A consumed approval cannot be reissued for the same identity.
    assert_eq!(
        dispatch::execute(root.path(), &envelope("tool-preflight", &r), &cancel).unwrap_err(),
        "BLK-PERM-001"
    );
    assert_eq!(
        ToolHost::default()
            .call(root.path(), &r, preview["requestDigest"].as_str().unwrap())
            .unwrap_err(),
        "BLK-TOOL-REPLAY"
    );
    let status = ToolHost::default()
        .status(root.path(), "project-test")
        .unwrap();
    assert_eq!(status["receipts"][0]["status"], "completed");
    assert!(!status.to_string().contains("three public words"));
}
#[test]
fn configuration_schema_and_secret_changes_fail_before_effects() {
    let root = profile();
    let registry = resource(root.path(), "http://127.0.0.1:54321/count");
    let host = ToolHost::default();
    let r = request("changed-binding");
    let old = host.preflight(root.path(), &r).unwrap();
    resource(root.path(), "http://127.0.0.1:54322/count");
    assert_eq!(
        host.call(root.path(), &r, old["requestDigest"].as_str().unwrap())
            .unwrap_err(),
        "BLK-PERM-001"
    );
    let mut invalid = r.clone();
    invalid.input = json!({"text":7});
    assert!(host.preflight(root.path(), &invalid).is_err());
    let mut changed = registry.clone();
    changed["resources"][0]["definition"]["permissions"] = json!(["shell"]);
    crate::user_store::UserStore::new(root.path().join("user"))
        .write("resources", "app", changed)
        .unwrap();
    assert_eq!(
        host.preflight(root.path(), &r).unwrap_err(),
        "BLK-TOOL-PERMISSION"
    );
    assert!(
        host.status(root.path(), "project-test").unwrap()["receipts"]
            .as_array()
            .unwrap()
            .is_empty()
    );
}
#[test]
fn active_cancel_keeps_unknown_receipt_until_explicit_reconciliation() {
    let root = profile();
    let (endpoint, server, received) = server(Duration::from_millis(350), json!({"words":3}));
    resource(root.path(), &endpoint);
    let host = ToolHost::default();
    let r = request("cancelled-http");
    let digest = host.preflight(root.path(), &r).unwrap()["requestDigest"]
        .as_str()
        .unwrap()
        .to_owned();
    let cancelled = Arc::new(AtomicBool::new(false));
    let signal = cancelled.clone();
    let trigger = std::thread::spawn(move || {
        let start = Instant::now();
        while !received.load(Ordering::SeqCst) {
            assert!(start.elapsed() < Duration::from_secs(3));
            std::thread::sleep(Duration::from_millis(5));
        }
        signal.store(true, Ordering::SeqCst);
    });
    assert_eq!(
        host.call_with_cancel(root.path(), &r, &digest, &cancelled)
            .unwrap_err(),
        "BLK-TOOL-CANCELLED"
    );
    trigger.join().unwrap();
    server.join().unwrap();
    assert_eq!(
        host.status(root.path(), "project-test").unwrap()["receipts"][0]["status"],
        "unknown"
    );
    let next = request("new-after-unknown");
    let d = host.preflight(root.path(), &next).unwrap();
    assert_eq!(d["unresolvedCalls"], 1);
    assert_eq!(
        host.call(root.path(), &next, d["requestDigest"].as_str().unwrap())
            .unwrap_err(),
        "BLK-TOOL-RECOVERY-REQUIRED"
    );
    assert_eq!(
        host.status(root.path(), "foreign-project").unwrap()["receipts"],
        json!([])
    );
    let reconcile = host
        .reconcile_preview(
            root.path(),
            "project-test",
            &r.request_id,
            "confirmed-completed",
        )
        .unwrap();
    assert!(host
        .reconcile(
            root.path(),
            "project-test",
            &r.request_id,
            "confirmed-not-applied",
            reconcile["requestDigest"].as_str().unwrap()
        )
        .is_err());
    host.reconcile(
        root.path(),
        "project-test",
        &r.request_id,
        "confirmed-completed",
        reconcile["requestDigest"].as_str().unwrap(),
    )
    .unwrap();
    assert_eq!(
        host.status(root.path(), "project-test").unwrap()["receipts"][0]["status"],
        "confirmed-completed"
    );
    assert!(host
        .reconcile_preview(
            root.path(),
            "project-test",
            &r.request_id,
            "confirmed-completed"
        )
        .is_err());
    // A reconciled receipt stays terminal; recovery does not execute or erase it.
    assert_eq!(
        ToolHost::default()
            .call(root.path(), &r, &digest)
            .unwrap_err(),
        "BLK-TOOL-REPLAY"
    );
}
#[test]
fn wrong_output_schema_does_not_claim_an_unapplied_operation() {
    let root = profile();
    let (endpoint, server, _) = server(Duration::ZERO, json!({"words":"wrong"}));
    resource(root.path(), &endpoint);
    let host = ToolHost::default();
    let r = request("invalid-output");
    let d = host.preflight(root.path(), &r).unwrap();
    assert!(host
        .call(root.path(), &r, d["requestDigest"].as_str().unwrap())
        .is_err());
    server.join().unwrap();
    assert_eq!(
        host.status(root.path(), "project-test").unwrap()["receipts"][0]["status"],
        "unknown"
    );
}
#[test]
fn a_stale_running_receipt_is_unknown_and_foreign_receipt_files_fail_closed() {
    let root = profile();
    let r = request("interrupted");
    let mut receipt = receipts::Receipt::begin(root.path(), &r, &"a".repeat(64)).unwrap();
    assert_eq!(
        ToolHost::default()
            .status(root.path(), "project-test")
            .unwrap()["receipts"][0]["status"],
        "running"
    );
    // Simulate process death without the normal receipt guard finalization.
    receipt.finish(&Err("BLK-TOOL-INTERRUPTED".into()),receipts::EffectState::MayHaveStarted).unwrap();
    drop(receipt);
    let file = std::fs::read_dir(root.path().join("tool-runs"))
        .unwrap()
        .map(|e| e.unwrap().path())
        .find(|p| p.extension().is_some_and(|e| e == "json"))
        .unwrap();
    let mut value: Value = serde_json::from_slice(&std::fs::read(&file).unwrap()).unwrap();
    value["status"] = json!("running");
    std::fs::write(&file, value.to_string()).unwrap();
    assert_eq!(
        ToolHost::default()
            .status(root.path(), "project-test")
            .unwrap()["receipts"][0]["status"],
        "unknown"
    );
    value["status"] = json!("completed");
    value["projectId"] = json!("foreign-project");
    std::fs::write(&file, value.to_string()).unwrap();
    assert_eq!(
        ToolHost::default()
            .status(root.path(), "project-test")
            .unwrap_err(),
        "BLK-TOOL-RECEIPT"
    );
}
#[test]
fn known_prelaunch_failure_allows_only_a_new_request_and_old_unknown_stays_blocked(){
    let root=profile();let digest="a".repeat(64);let first=request("not-started");
    let mut receipt=receipts::Receipt::begin(root.path(),&first,&digest).unwrap();
    receipt.finish(&Err("BLK-TOOL-OWNERSHIP-SCHEMA".into()),receipts::EffectState::NotStarted).unwrap();drop(receipt);
    assert_eq!(ToolHost::default().status(root.path(),"project-test").unwrap()["receipts"][0]["status"],"failed");
    assert!(receipts::Receipt::begin(root.path(),&first,&digest).is_err());
    let second=request("new-request");let mut second_receipt=receipts::Receipt::begin(root.path(),&second,&digest).unwrap();
    second_receipt.finish(&Err("BLK-MCP-CLOSED".into()),receipts::EffectState::MayHaveStarted).unwrap();drop(second_receipt);
    let error=receipts::Receipt::begin(root.path(),&request("after-unknown"),&digest).err().unwrap();
    assert_eq!(error,"BLK-TOOL-RECOVERY-REQUIRED");
}
#[test]
fn tool_request_only_contains_resource_references_and_bounded_business_input() {
    let value = json!({"schemaVersion":"blocky.tool-request/v2","projectId":"project-test","runId":"run-test","requestId":"request-test","resourceId":"tool-test","action":"call","input":{"query":"public"},"timeoutMs":3000});
    let request: ToolRequest = serde_json::from_value(value.clone()).unwrap();
    request.validate().unwrap();
    for key in ["endpoint", "path", "command", "headers", "approval"] {
        let mut changed = value.clone();
        changed[key] = json!("forbidden");
        assert!(serde_json::from_value::<ToolRequest>(changed).is_err());
    }
    for action in ["discover", "read-resource", "shell"] {
        let mut changed = request.clone();
        changed.action = action.into();
        assert!(changed.validate().is_err());
    }
    let mut read = request.clone();
    read.action = "read-resource".into();
    read.input = json!({"uriRef":format!("uri-{}","a".repeat(64))});
    read.validate().unwrap();
    read.input = json!({"uriRef":"file:///host-private-file"});
    assert!(read.validate().is_err());
}

#[test]
fn native_operation_cancel_before_preflight_or_after_preview_blocks_approval_and_effects() {
    let root = profile();
    resource(root.path(), "http://127.0.0.1:54321/count");
    let host = ToolHost::default();
    let first = request("cancel-before-preflight");
    let operation = host.begin(&first).unwrap();
    host.cancel(&first.request_id).unwrap();
    assert_eq!(
        operation.preflight(root.path()).unwrap_err(),
        "BLK-TOOL-CANCELLED"
    );
    assert_eq!(operation.check_cancel().unwrap_err(), "BLK-TOOL-CANCELLED");
    drop(operation);
    assert!(host.begin(&first).is_err());

    let second = request("cancel-after-preview");
    let operation = host.begin(&second).unwrap();
    let preview = operation.preflight(root.path()).unwrap();
    let digest = preview["requestDigest"].as_str().unwrap();
    operation.destination(root.path(), digest).unwrap();
    host.cancel(&second.request_id).unwrap();
    assert_eq!(operation.check_cancel().unwrap_err(), "BLK-TOOL-CANCELLED");
    assert_eq!(
        operation.call(root.path(), digest).unwrap_err(),
        "BLK-TOOL-CANCELLED"
    );
    assert_eq!(
        host.status(root.path(), "project-test").unwrap()["receipts"],
        json!([])
    );
    drop(operation);
    host.shutdown().unwrap();
}
