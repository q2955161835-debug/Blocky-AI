use super::*;
fn files() -> ProjectFiles {
    BTreeMap::from([("project.json".into(),r#"{"schemaVersion":"blocky.project/v1","projectId":"sample","displayName":"Sample","modules":[{"moduleId":"main","displayName":"Main","purpose":"agent","workspaceRef":"workspaces/main.json","exports":[]}],"resources":[],"appSurfaces":[],"format":{"createdWith":"0.1.0","minimumReaderVersion":"0.1.0"}}"#.into()),("workspaces/main.json".into(),r#"{"blocks":{"languageVersion":0,"blocks":[]}}"#.into())])
}
fn check() -> TaskRequest {
    TaskRequest {
        task_id: "blocky.project-check".into(),
        parameters: BTreeMap::from([("passes".into(), 360), ("interval-ms".into(), 1000)]),
        timeout_ms: 30000,
        output_budget_bytes: 1024,
    }
}
fn inventory() -> TaskRequest {
    TaskRequest {
        task_id: "blocky.project-inventory".into(),
        parameters: BTreeMap::from([("limit".into(), 1000)]),
        timeout_ms: 30000,
        output_budget_bytes: 1024,
    }
}
fn await_done(host: &TaskHost, id: &str) -> TaskSnapshot {
    let start = std::time::Instant::now();
    loop {
        let state = host.snapshot(id).unwrap();
        if state.active_processes == 0 {
            return state;
        }
        assert!(start.elapsed() < Duration::from_secs(8));
        std::thread::sleep(Duration::from_millis(10));
    }
}
#[test]
fn worker_entry() {
    if std::env::var("BLOCKY_TASK_TEST_WORKER").as_deref() == Ok("1") {
        std::process::exit(worker_main());
    }
}
#[test]
fn registry_concurrency_cancel_inventory_and_budget() {
    let host = TaskHost::default();
    let long = host.start(check(), files()).unwrap();
    assert_eq!(host.start(check(), files()).unwrap_err(), "BLK-TERM-103");
    let id = host.start(inventory(), files()).unwrap();
    let result = await_done(&host, &id);
    assert_eq!(result.status, "exited", "{}", result.output);
    assert!(result.output.contains("BLK-INVENTORY-000"));
    assert!(result.output.contains("\"fileCount\":2"));
    assert!(!result.output.contains("displayName"));
    host.cancel(&long).unwrap();
    assert_eq!(await_done(&host, &long).status, "cancelled");
    let mut short = check();
    short.timeout_ms = 30;
    let id = host.start(short, files()).unwrap();
    assert_eq!(await_done(&host, &id).status, "timed-out");
    let mut many = check();
    many.parameters.insert("interval-ms".into(), 0);
    many.output_budget_bytes = 256;
    let id = host.start(many, files()).unwrap();
    let result = await_done(&host, &id);
    assert_eq!(result.status, "exited");
    assert!(result.output_bytes <= 256 && result.dropped_bytes > 0 && result.truncated);
    host.shutdown().unwrap();
    assert_eq!(host.active(), 0);
}
#[test]
fn host_tickets_are_scoped_single_use_and_not_caller_claims() {
    let host = TaskHost::default();
    let token = host
        .grant_agent("agent-a", vec!["blocky.project-inventory".into()], 10000)
        .unwrap();
    let request = AgentProcessRequest {
        request_id: "request-a".into(),
        task_id: "blocky.project-inventory".into(),
        arguments: BTreeMap::from([("limit".into(), 1000)]),
        capability_id: token,
        timeout_ms: 30000,
        output_budget_bytes: 1024,
    };
    assert_eq!(
        host.start_agent("agent-b", request.clone(), files())
            .unwrap_err(),
        "BLK-TERM-003"
    );
    let mut forged = request.clone();
    forged.capability_id = uuid::Uuid::new_v4().to_string();
    assert!(host.start_agent("agent-a", forged, files()).is_err());
    let id = host
        .start_agent("agent-a", request.clone(), files())
        .unwrap();
    assert!(host.start_agent("agent-a", request, files()).is_err());
    assert!(host.snapshot_agent("agent-b", &id).is_err());
    assert!(host.cancel_agent("agent-b", &id).is_err());
    assert!(host.snapshot_agent("agent-a", &id).is_ok());
    await_done(&host, &id);
    let token = host
        .grant_agent("agent-a", vec!["blocky.project-check".into()], 1)
        .unwrap();
    std::thread::sleep(Duration::from_millis(5));
    let expired = AgentProcessRequest {
        request_id: "expired".into(),
        task_id: "blocky.project-check".into(),
        arguments: check().parameters,
        capability_id: token,
        timeout_ms: 100,
        output_budget_bytes: 1024,
    };
    assert!(host.start_agent("agent-a", expired, files()).is_err());
    assert!(serde_json::from_value::<AgentProcessRequest>(serde_json::json!({"requestId":"forged","taskId":"blocky.project-check","arguments":{},"capabilityId":"fake","timeoutMs":100,"outputBudgetBytes":1024,"caller":{"kind":"user"},"terminalSessionId":"private"})).is_err());
    host.shutdown().unwrap();
}
