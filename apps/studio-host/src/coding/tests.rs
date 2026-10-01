use super::*;
use std::fs;
#[test]
fn opaque_workspace_and_file_edit_create_conflict_undo() {
    let dir = tempfile::tempdir().unwrap();
    let host = CodingHost::default();
    let grant = host.grant(dir.path()).unwrap();
    assert!(grant.get("path").is_none());
    assert!(
        !grant
            .to_string()
            .contains(&dir.path().to_string_lossy().to_string())
    );
    let workspace = grant["workspaceId"].as_str().unwrap();
    let scope = host.scope(Some(workspace)).unwrap().unwrap();
    assert!(host.scope(Some("workspace-unknown")).is_err());
    fs::write(dir.path().join("code.ts"), "before\n").unwrap();
    let read = scope.read("code.ts").unwrap();
    assert!(scope.write("code.ts", "oops", None).is_err());
    assert!(
        scope
            .write("code.ts", "oops", Some(&files::digest("other")))
            .is_err()
    );
    let change = scope
        .write("code.ts", "after\n", read["digest"].as_str())
        .unwrap();
    host.record(workspace, &change).unwrap();
    fs::write(dir.path().join("code.ts"), "external\n").unwrap();
    assert_eq!(
        host.undo(workspace, change["changeId"].as_str().unwrap())
            .unwrap_err(),
        "BLK-CODING-CONFLICT"
    );
    fs::write(dir.path().join("code.ts"), "after\n").unwrap();
    host.undo(workspace, change["changeId"].as_str().unwrap())
        .unwrap();
    assert_eq!(
        fs::read_to_string(dir.path().join("code.ts")).unwrap(),
        "before\n"
    );
    let nested = scope
        .write("src/components/new.ts", "nested\n", None)
        .unwrap();
    assert_eq!(
        fs::read_to_string(dir.path().join("src/components/new.ts")).unwrap(),
        "nested\n"
    );
    host.record(workspace, &nested).unwrap();
    host.undo(workspace, nested["changeId"].as_str().unwrap())
        .unwrap();
    let created = scope.write("new.ts", "new\n", None).unwrap();
    host.record(workspace, &created).unwrap();
    host.undo(workspace, created["changeId"].as_str().unwrap())
        .unwrap();
    assert!(!dir.path().join("new.ts").exists());
}
#[test]
fn files_reject_traversal_secrets_binary_budget_and_links() {
    let dir = tempfile::tempdir().unwrap();
    let scope = files::Scope::new(dir.path()).unwrap();
    for path in [
        "../escape",
        "/root",
        "C:/secret",
        "file:ads",
        "a\\b",
        ".env",
        "dir/.env.local",
        ".git/config",
        "file.blocky",
        "secret.pem",
        "NUL.txt",
        "trailing.",
    ] {
        assert!(scope.write(path, "text", None).is_err(), "{path}");
    }
    fs::write(dir.path().join("binary"), [0, 255]).unwrap();
    assert!(scope.read("binary").is_err());
    fs::write(
        dir.path().join("secret.ts"),
        "sk-abcdefghijklmnopqrstuvwxyz1234567890123456",
    )
    .unwrap();
    assert!(scope.read("secret.ts").is_err());
    fs::write(
        dir.path().join("config.json"),
        r#"{"apiKey":"custom-value"}"#,
    )
    .unwrap();
    assert!(scope.read("config.json").is_err());
    assert!(
        scope
            .write(
                "credentials.ts",
                r#"const config={"apiKey":"custom-value"}"#,
                None
            )
            .is_err()
    );
    fs::write(dir.path().join("large"), vec![b'a'; files::LIMIT + 1]).unwrap();
    assert!(scope.read("large").is_err());
    fs::write(dir.path().join("one"), "one").unwrap();
    fs::hard_link(dir.path().join("one"), dir.path().join("two")).unwrap();
    assert!(scope.read("two").is_err());
    assert!(
        scope
            .write("one", "overwrite", Some(&files::digest("one")))
            .is_err()
    );
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(dir.path().join("binary"), dir.path().join("link")).unwrap();
        assert!(scope.read("link").is_err());
        std::os::unix::fs::symlink(dir.path(), dir.path().join("linked-dir")).unwrap();
        assert!(scope.read("linked-dir/secret.ts").is_err());
    }
    let entries = scope.list(None).unwrap();
    assert!(
        entries
            .iter()
            .all(|e| e["path"] != "one" && e["path"] != "two")
    );
}
#[test]
fn deterministic_search_and_scope_owner() {
    let dir = tempfile::tempdir().unwrap();
    fs::create_dir(dir.path().join("src")).unwrap();
    fs::write(dir.path().join("src/a.ts"), "needle\nother\nneedle\n").unwrap();
    fs::write(dir.path().join("z.ts"), "needle\n").unwrap();
    let host = CodingHost::default();
    let grant = host.grant(dir.path()).unwrap();
    let workspace = grant["workspaceId"].as_str().unwrap();
    let scope = host.scope(Some(workspace)).unwrap().unwrap();
    let entries = scope.list(None).unwrap();
    assert_eq!(entries[0]["path"], "src");
    assert_eq!(
        scope.search("needle", Some("src")).unwrap()["matches"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
    let change = scope.write("new.ts", "content", None).unwrap();
    host.record(workspace, &change).unwrap();
    assert!(
        host.undo("workspace-other", change["changeId"].as_str().unwrap())
            .is_err()
    );
    host.cancel("request-before-start").unwrap();
    assert!(
        host.state
            .lock()
            .unwrap()
            .used
            .contains("request-before-start")
    );
    host.shutdown().unwrap();
    assert!(host.grant(dir.path()).is_err());
}
#[test]
fn failed_atomic_publish_restores_or_retains_recoverable_original() {
    let dir = tempfile::tempdir().unwrap();
    let scope = files::Scope::new(dir.path()).unwrap();
    fs::write(dir.path().join("code.ts"), "original").unwrap();
    let mut receipts = Vec::new();
    scope.fail_next_publish(1);
    assert!(
        scope
            .write_tracked(
                "code.ts",
                "replacement",
                Some(&files::digest("original")),
                &mut |c| receipts.push(c)
            )
            .is_err()
    );
    assert!(receipts.is_empty());
    assert_eq!(
        fs::read_to_string(dir.path().join("code.ts")).unwrap(),
        "original"
    );
    scope.fail_next_publish(2);
    assert!(
        scope
            .write_tracked(
                "code.ts",
                "replacement",
                Some(&files::digest("original")),
                &mut |c| receipts.push(c)
            )
            .is_err()
    );
    assert_eq!(
        fs::read_to_string(dir.path().join("code.ts")).unwrap(),
        "external occupant"
    );
    assert_eq!(receipts.len(), 1);
    assert_eq!(receipts[0]["before"], "original");
    assert!(receipts[0]["after"].is_null());
    assert!(scope.undo(&receipts[0]).is_err()); // Never overwrite the other writer.
    fs::remove_file(dir.path().join("code.ts")).unwrap();
    scope.undo(&receipts[0]).unwrap();
    assert_eq!(
        fs::read_to_string(dir.path().join("code.ts")).unwrap(),
        "original"
    );
    assert!(
        scope
            .list(None)
            .unwrap()
            .iter()
            .all(|e| !e["path"].as_str().unwrap().starts_with(".blocky-coding-"))
    );
}
#[test]
fn host_receipts_survive_cancel_and_cancel_blocks_next_mutation() {
    let dir = tempfile::tempdir().unwrap();
    let host = CodingHost::default();
    let grant = host.grant(dir.path()).unwrap();
    let workspace = grant["workspaceId"].as_str().unwrap();
    let scope = host.scope(Some(workspace)).unwrap().unwrap();
    let start:CodingStart=serde_json::from_value(json!({"schemaVersion":"blocky.coding-start/v1","requestId":"receipt-task","projectId":"sample","moduleId":"main","prompt":"test","originalJson":"{}","resourceId":"model","selection":[],"conversation":[],"workspaceId":workspace})).unwrap();
    let cancel = Arc::new(AtomicBool::new(false));
    {
        let mut state = host.state.lock().unwrap();
        state.used.insert(start.request_id.clone());
        state
            .active
            .insert(start.request_id.clone(), cancel.clone());
    }
    let project = json!({"manifest":{"schemaVersion":"blocky.project/v1","projectId":"sample","displayName":"Sample","modules":[{"moduleId":"main","displayName":"Main","purpose":"agent","workspaceRef":"workspaces/main.json","exports":[]}],"resources":[],"appSurfaces":[],"format":{"createdWith":"0.8.0","minimumReaderVersion":"0.4.0"}},"workspaces":{"main":{"blocks":{"languageVersion":0,"blocks":[]}}},"resources":{},"schemas":{},"surfaces":{}});
    let mut cli = cli::Cli::new(dir.path(), &start, project).unwrap();
    host.tool(
        &start,
        Some(&scope),
        &mut cli,
        "workspace_write",
        &json!({"path":"first.ts","text":"first","expectedDigest":null}),
        &cancel,
    )
    .unwrap();
    host.cancel(&start.request_id).unwrap();
    assert_eq!(host.changes(&start.request_id).unwrap().len(), 1);
    assert!(
        host.tool(
            &start,
            Some(&scope),
            &mut cli,
            "workspace_write",
            &json!({"path":"second.ts","text":"second","expectedDigest":null}),
            &cancel
        )
        .is_err()
    );
    assert!(!dir.path().join("second.ts").exists());
}
#[test]
fn undo_returns_registered_inverse_and_removes_old_change() {
    let dir = tempfile::tempdir().unwrap();
    let host = CodingHost::default();
    let grant = host.grant(dir.path()).unwrap();
    let workspace = grant["workspaceId"].as_str().unwrap();
    let scope = host.scope(Some(workspace)).unwrap().unwrap();
    let created = scope.write("file.ts", "original", None).unwrap();
    let first_id = created["changeId"].as_str().unwrap();
    host.record(workspace, &created).unwrap();
    let inverse = host.undo(workspace, first_id).unwrap();
    let inverse_id = inverse["changeId"].as_str().unwrap();
    assert_eq!(inverse["revertsChangeId"], first_id);
    assert!(!host.state.lock().unwrap().changes.contains_key(first_id));
    assert!(host.state.lock().unwrap().changes.contains_key(inverse_id));
    host.undo(workspace, inverse_id).unwrap();
    assert_eq!(
        fs::read_to_string(dir.path().join("file.ts")).unwrap(),
        "original"
    );
}
#[test]
fn streaming_and_final_text_use_protocol_utf16_units() {
    assert!(process::bounded_text(&json!("中".repeat(6000)), 16384).is_ok());
    assert!(process::bounded_text(&json!("😀".repeat(8192)), 16384).is_ok());
    assert!(process::bounded_text(&json!("😀".repeat(8193)), 16384).is_err());
    assert!(process::bounded_text(&json!("中".repeat(64000)), 64000).is_ok());
    assert!(process::bounded_text(&json!("😀".repeat(32000)), 64000).is_ok());
    assert!(process::bounded_text(&json!("😀".repeat(32001)), 64000).is_err());
    assert!(process::bounded_text(&json!(null), 64000).is_err());
}
#[test]
fn repeated_undo_compacts_only_superseded_receipts_within_budget() {
    let dir = tempfile::tempdir().unwrap();
    let host = CodingHost::default();
    let grant = host.grant(dir.path()).unwrap();
    let workspace = grant["workspaceId"].as_str().unwrap();
    let scope = host.scope(Some(workspace)).unwrap().unwrap();
    let change = scope.write("one.txt", "value", None).unwrap();
    host.record(workspace, &change).unwrap();
    {
        let mut s = host.state.lock().unwrap();
        s.used.insert("undo-task".into());
        s.receipts.insert("undo-task".into(), vec![change.clone()]);
    }
    let mut id = change["changeId"].as_str().unwrap().to_owned();
    for _ in 0..600 {
        let inverse = host.undo(workspace, &id).unwrap();
        id = inverse["changeId"].as_str().unwrap().to_owned();
    }
    let s = host.state.lock().unwrap();
    assert!(s.receipts.values().map(Vec::len).sum::<usize>() <= 512);
    assert!(
        s.receipts
            .values()
            .flatten()
            .map(|c| c.to_string().len())
            .sum::<usize>()
            <= 64 * 1024 * 1024
    );
    assert_eq!(s.changes.len(), 1);
    assert!(s.receipts.values().flatten().any(|c| c["changeId"] == id));
}
#[test]
fn failed_undo_reports_invalidation_and_recovery_never_overwrites_an_occupant() {
    let dir = tempfile::tempdir().unwrap();
    let host = CodingHost::default();
    let grant = host.grant(dir.path()).unwrap();
    let workspace = grant["workspaceId"].as_str().unwrap();
    let scope = host.scope(Some(workspace)).unwrap().unwrap();
    fs::write(dir.path().join("code.ts"), "before").unwrap();
    let change = scope
        .write("code.ts", "after", Some(&files::digest("before")))
        .unwrap();
    host.record(workspace, &change).unwrap();
    {
        let mut s = host.state.lock().unwrap();
        s.used.insert("undo-task".into());
        s.receipts.insert("undo-task".into(), vec![change.clone()]);
    }
    scope.fail_next_publish(2);
    assert!(
        host.undo(workspace, change["changeId"].as_str().unwrap())
            .is_err()
    );
    let recovery = host.changes("undo-task").unwrap().last().unwrap().clone();
    assert_eq!(recovery["invalidatesChangeId"], change["changeId"]);
    assert!(recovery.get("revertsChangeId").is_none());
    assert_eq!(recovery["before"], "after");
    assert!(recovery["after"].is_null());
    assert_eq!(
        fs::read_to_string(dir.path().join("code.ts")).unwrap(),
        "external occupant"
    );
    assert!(
        host.undo(workspace, recovery["changeId"].as_str().unwrap())
            .is_err()
    );
    fs::remove_file(dir.path().join("code.ts")).unwrap();
    host.undo(workspace, recovery["changeId"].as_str().unwrap())
        .unwrap();
    assert_eq!(
        fs::read_to_string(dir.path().join("code.ts")).unwrap(),
        "after"
    );
}
#[test]
fn undo_reserves_escaped_receipt_bytes_before_changing_file() {
    let dir = tempfile::tempdir().unwrap();
    let host = CodingHost::default();
    let grant = host.grant(dir.path()).unwrap();
    let workspace = grant["workspaceId"].as_str().unwrap();
    let scope = host.scope(Some(workspace)).unwrap().unwrap();
    let before = "\"".repeat(files::LIMIT);
    let after = "\\".repeat(files::LIMIT);
    let mut changes = Vec::new();
    for index in 0..15 {
        let path = format!("large-{index}.txt");
        scope.write(&path, &before, None).unwrap();
        let change = scope
            .write(&path, &after, Some(&files::digest(&before)))
            .unwrap();
        host.record(workspace, &change).unwrap();
        changes.push(change);
    }
    {
        let mut s = host.state.lock().unwrap();
        s.used.insert("budget-task".into());
        s.receipts.insert("budget-task".into(), changes.clone());
    }
    assert_eq!(
        host.undo(workspace, changes[0]["changeId"].as_str().unwrap())
            .unwrap_err(),
        "BLK-CODING-BUDGET"
    );
    assert_eq!(scope.read("large-0.txt").unwrap()["text"], after);
    assert!(
        host.state
            .lock()
            .unwrap()
            .changes
            .contains_key(changes[0]["changeId"].as_str().unwrap())
    );
}
#[test]
fn failure_receipt_keeps_bound_actual_changes_after_cancel() {
    let dir = tempfile::tempdir().unwrap();
    let host = CodingHost::default();
    let grant = host.grant(dir.path()).unwrap();
    let workspace = grant["workspaceId"].as_str().unwrap();
    let scope = host.scope(Some(workspace)).unwrap().unwrap();
    let mut start:CodingStart=serde_json::from_value(json!({"schemaVersion":"blocky.coding-start/v1","requestId":"failed-task","projectId":"sample","moduleId":"main","prompt":"test","originalJson":"{}","resourceId":"model","selection":[],"conversation":[],"workspaceId":workspace})).unwrap();
    let change = scope.write("actual.ts", "actual", None).unwrap();
    host.record(workspace, &change).unwrap();
    {
        let mut s = host.state.lock().unwrap();
        s.used.insert(start.request_id.clone());
        s.receipts
            .insert(start.request_id.clone(), vec![change.clone()]);
    }
    host.cancel(&start.request_id).unwrap();
    let receipt = failure_receipt(&host, &start, "BLK-CODING-CANCELLED");
    assert_eq!(receipt["requestId"], start.request_id);
    assert_eq!(receipt["projectId"], start.project_id);
    assert_eq!(receipt["baseDigest"], files::digest(&start.original_json));
    assert_eq!(receipt["changes"], json!([change]));
    assert_eq!(receipt["modelApiCalled"], false);
    start.request_id = "other-task".into();
    assert!(
        failure_receipt(&host, &start, "BLK-CODING-CANCELLED")["changes"]
            .as_array()
            .unwrap()
            .is_empty()
    );
}

#[test]
fn both_native_entries_return_non_success_with_bound_failure_receipts() {
    let receipt = json!({"schemaVersion":"blocky.coding-failure/v1","requestId":"task-one","projectId":"sample","baseDigest":"a".repeat(64),"code":"BLK-CODING-CANCELLED","changes":[],"modelApiCalled":true});
    let response = super::native_reply(Ok(receipt.clone()));
    assert_eq!(response["schemaVersion"], "blocky.project-io/v1alpha1");
    assert_eq!(response["ok"], false);
    assert_eq!(response["code"], receipt["code"]);
    assert_eq!(response["value"], receipt);
    let completed = json!({"schemaVersion":"blocky.coding-result/v1"});
    let response = super::native_reply(Ok(completed.clone()));
    assert_eq!(response["ok"], true);
    assert_eq!(response["value"], completed);
    assert_eq!(
        super::native_reply(Err("BLK-CODING-INPUT".into()))["ok"],
        false
    );
}
