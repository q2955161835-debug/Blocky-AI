use super::*;
use serde_json::json;
pub(super) fn prepared() -> Prepared {
    let plan:Plan=serde_json::from_value(json!({"schemaVersion":"blocky.rpa/v1","planId":"test","target":{"kind":"windows","identity":"fixture"},"steps":[{"stepId":"first","action":"click","locator":{"kind":"uia","automationId":"ok"},"effectKey":"once"},{"stepId":"second","action":"find","locator":{"kind":"uia","automationId":"done"}}]})).unwrap();
    Prepared {
        plan,
        target: target::Target {
            identity: "fixture".into(),
            window: 0,
            process_id: 0,
            created: 0,
            class_name: "fixture".into(),
            title: "fixture".into(),
        }
        .into(),
        root_id: vec![1, 2],
        preview: json!({}),
    }
}
fn grant(host: &RpaHost) -> String {
    host.insert(prepared()).unwrap()["sessionId"]
        .as_str()
        .unwrap()
        .to_owned()
}
pub(super) fn journal_directory() -> tempfile::TempDir {
    let root = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../try/stage7/rpa-journal-tests");
    std::fs::create_dir_all(&root).unwrap();
    tempfile::tempdir_in(root).unwrap()
}
#[test]
fn journal_records_uncertainty_before_effect_and_survives_host_restart() {
    let root = journal_directory();
    let host = RpaHost::with_journal(root.path().to_owned());
    let mut proposal = prepared();
    if let Binding::Windows(target) = &mut proposal.target {
        target.title = "PRIVATE_WINDOW_TITLE_CANARY".into();
    }
    let plan = proposal.plan.clone();
    let token = host.insert(proposal).unwrap()["sessionId"]
        .as_str()
        .unwrap()
        .to_owned();
    let id = host.status(&token).unwrap()["checkpointId"]
        .as_str()
        .unwrap()
        .to_owned();
    let store = journal::Store::new(root.path().to_owned());
    host.step_with(&token, "first", None, |_, _, _| {
        let saved = store.read_bound(&id, &plan).unwrap();
        assert_eq!(saved.next, 0);
        assert_eq!(saved.receipts[0].status, "uncertain");
        Ok(json!({"invoked":true,"privateRead":"PRIVATE_OUTPUT_CANARY"}))
    })
    .unwrap();
    drop(host);
    let reopened = journal::Store::new(root.path().to_owned());
    let saved = reopened.read_bound(&id, &plan).unwrap();
    assert_eq!(saved.next, 1);
    assert_eq!(saved.receipts[0].status, "completed");
    assert!(!saved.receipts[0].verified);
    assert!(reopened.save(saved.clone(), 0).is_err());
    assert_eq!(
        reopened.save(saved.clone(), 1).unwrap_err(),
        "BLK-RPA-JOURNAL-003"
    );
    let mut changed = plan.clone();
    changed.plan_id = "changed-plan".into();
    assert!(reopened.read_bound(&id, &changed).is_err());
    let bytes = std::fs::read(root.path().join(format!("{id}.bin"))).unwrap();
    for canary in [
        "PRIVATE_WINDOW_TITLE_CANARY",
        "PRIVATE_OUTPUT_CANARY",
        token.as_str(),
    ] {
        assert!(
            !bytes
                .windows(canary.len())
                .any(|part| part == canary.as_bytes())
        );
    }
    let summary = serde_json::to_string(&reopened.summaries().unwrap()).unwrap();
    assert!(!summary.contains("PRIVATE"));
    assert!(!summary.contains(&token));
}
#[test]
fn journal_persistence_failure_prevents_effect_and_rejects_corruption() {
    let root = journal_directory();
    let host = RpaHost::with_journal(root.path().to_owned());
    let token = grant(&host);
    let id = host.status(&token).unwrap()["checkpointId"]
        .as_str()
        .unwrap()
        .to_owned();
    let lock = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(root.path().join("journal.lock"))
        .unwrap();
    lock.try_lock().unwrap();
    assert!(
        host.step_with(&token, "first", None, |_, _, _| panic!(
            "effect before durable receipt"
        ))
        .is_err()
    );
    drop(lock);
    assert_eq!(host.status(&token).unwrap()["status"], "persistence-failed");
    assert!(
        host.step_with(&token, "first", None, |_, _, _| panic!(
            "retry after journal failure"
        ))
        .is_err()
    );
    let path = root.path().join(format!("{id}.bin"));
    let mut bytes = std::fs::read(&path).unwrap();
    *bytes.last_mut().unwrap() ^= 1;
    std::fs::write(&path, bytes).unwrap();
    assert!(
        journal::Store::new(root.path().to_owned())
            .read_bound(&id, &prepared().plan)
            .is_err()
    );
}
#[test]
fn journal_failed_completion_write_keeps_uncertain_disk_receipt_and_blocks_next_step() {
    let root = journal_directory();
    let host = RpaHost::with_journal(root.path().to_owned());
    let token = grant(&host);
    let id = host.status(&token).unwrap()["checkpointId"]
        .as_str()
        .unwrap()
        .to_owned();
    let mut held_lock = None;
    let result = host.step_with(&token, "first", None, |_, _, _| {
        let lock = std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .open(root.path().join("journal.lock"))
            .unwrap();
        lock.try_lock().unwrap();
        held_lock = Some(lock);
        Ok(json!({"invoked":true}))
    });
    assert_eq!(result.unwrap_err(), "BLK-RPA-JOURNAL-003");
    drop(held_lock);
    let saved = journal::Store::new(root.path().to_owned())
        .inspect(&id)
        .unwrap();
    assert_eq!(saved["completedSteps"], 0);
    assert_eq!(saved["receipts"][0]["status"], "uncertain");
    assert_eq!(saved["resumable"], false);
    assert_eq!(host.status(&token).unwrap()["status"], "persistence-failed");
    assert!(
        host.step_with(&token, "second", None, |_, _, _| panic!(
            "continued after failed commit"
        ))
        .is_err()
    );
}
#[test]
fn journal_records_pause_and_stop_and_rejects_dispatch_path_injection() {
    let root = journal_directory();
    let host = RpaHost::with_journal(root.path().to_owned());
    let token = grant(&host);
    let id = host.status(&token).unwrap()["checkpointId"]
        .as_str()
        .unwrap()
        .to_owned();
    let store = journal::Store::new(root.path().to_owned());
    host.pause(&token).unwrap();
    assert_eq!(store.inspect(&id).unwrap()["status"], "paused");
    host.stop(&token).unwrap();
    assert_eq!(store.inspect(&id).unwrap()["status"], "stopped");
    let request = json!({"schemaVersion":"blocky.project-io/v1alpha1","operation":"rpa-checkpoint","checkpointId":id,"plan":prepared().plan});
    assert!(journal::dispatch(root.path().to_owned(), request.clone()).is_ok());
    let mut injection = request.clone();
    injection["path"] = json!("../other");
    assert!(journal::dispatch(root.path().to_owned(), injection).is_err());
    let mut changed = request;
    changed["plan"]["steps"][0]["effectKey"] = json!("changed");
    assert_eq!(
        journal::dispatch(root.path().to_owned(), changed).unwrap_err(),
        "BLK-RPA-JOURNAL-002"
    );
    assert!(store.inspect("checkpoint-../../other").is_err());
}
#[test]
fn journal_capacity_prevents_new_grant_without_removing_receipts() {
    let root = journal_directory();
    for i in 0..100 {
        std::fs::write(
            root.path().join(format!("checkpoint-{i}.bin")),
            b"preserved",
        )
        .unwrap();
    }
    let host = RpaHost::with_journal(root.path().to_owned());
    assert_eq!(host.insert(prepared()).unwrap_err(), "BLK-RPA-JOURNAL-004");
    assert!(host.sessions.lock().unwrap().is_empty());
    assert_eq!(
        std::fs::read(root.path().join("checkpoint-0.bin")).unwrap(),
        b"preserved"
    );
}
#[test]
fn recovery_fixture() {
    let Some(root) = std::env::var_os("BLOCKY_RPA_JOURNAL_FIXTURE") else {
        return;
    };
    let host = RpaHost::with_journal(root.into());
    let token = grant(&host);
    host.step_with(&token, "first", None, |_, _, _| Ok(json!({"invoked":true})))
        .unwrap();
    // Exit the owning process at a clean step boundary, without a saved grant.
    std::process::exit(0);
}
#[test]
fn journal_retries_brief_replace_denial_without_repeating_effect() {
    use std::os::windows::fs::OpenOptionsExt;
    let root = journal_directory();
    let host = RpaHost::with_journal(root.path().to_owned());
    let token = grant(&host);
    let id = host.status(&token).unwrap()["checkpointId"]
        .as_str()
        .unwrap()
        .to_owned();
    let reader = std::fs::OpenOptions::new()
        .read(true)
        .share_mode(3)
        .open(root.path().join(format!("{id}.bin")))
        .unwrap();
    let release = std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(80));
        drop(reader);
    });
    let calls = std::sync::atomic::AtomicUsize::new(0);
    let result = host.step_with(&token, "first", None, |_, _, _| {
        calls.fetch_add(1, Ordering::SeqCst);
        Ok(json!({"invoked":true}))
    });
    release.join().unwrap();
    result.unwrap();
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    assert_eq!(
        journal::Store::new(root.path().to_owned())
            .inspect(&id)
            .unwrap()["completedSteps"],
        1
    );
}
#[test]
fn journal_persistent_replace_denial_preserves_receipt_and_prevents_effect() {
    use std::os::windows::fs::OpenOptionsExt;
    let root = journal_directory();
    let host = RpaHost::with_journal(root.path().to_owned());
    let token = grant(&host);
    let id = host.status(&token).unwrap()["checkpointId"]
        .as_str()
        .unwrap()
        .to_owned();
    let path = root.path().join(format!("{id}.bin"));
    let before = std::fs::read(&path).unwrap();
    let reader = std::fs::OpenOptions::new()
        .read(true)
        .share_mode(3)
        .open(&path)
        .unwrap();
    let start = std::time::Instant::now();
    assert_eq!(
        host.step_with(&token, "first", None, |_, _, _| panic!(
            "unpersisted intent must never execute"
        ))
        .unwrap_err(),
        "BLK-RPA-JOURNAL-001"
    );
    assert!(start.elapsed() < Duration::from_secs(2));
    assert_eq!(std::fs::read(path).unwrap(), before);
    drop(reader);
}
fn exited_owner_snapshot(root: &std::path::Path) -> journal::Snapshot {
    use std::os::windows::process::CommandExt;
    let output = std::process::Command::new(std::env::current_exe().unwrap())
        .args(["--exact", "rpa::tests::recovery_fixture", "--nocapture"])
        .env("BLOCKY_RPA_JOURNAL_FIXTURE", root)
        .creation_flags(0x08000000)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "owned recovery fixture failed: {} {}",
        output.status,
        String::from_utf8_lossy(&output.stderr[..output.stderr.len().min(4096)])
    );
    let store = journal::Store::new(root.to_owned());
    let summary = store.summaries().unwrap().remove(0);
    store
        .read_bound(summary["checkpointId"].as_str().unwrap(), &prepared().plan)
        .unwrap()
}
#[test]
fn recovery_transfers_exited_owner_once_and_never_replays_completed_effect() {
    let root = journal_directory();
    let saved = exited_owner_snapshot(root.path());
    assert!(!saved.owner.as_ref().unwrap().is_alive().unwrap());
    let request = recovery::Request {
        schema_version: "blocky.rpa-recovery/v1".into(),
        checkpoint_id: saved.checkpoint_id.clone(),
        revision: saved.revision,
        checks: vec![recovery::Check {
            step_id: "first".into(),
            locator: prepared().plan.steps[1].locator.clone(),
            expected_text: None,
        }],
    };
    let host = RpaHost::with_journal(root.path().to_owned());
    assert!(host.recovery_snapshot(&prepared().plan, &request).is_ok());
    let grant = host
        .insert_checkpoint(prepared(), Some(saved.clone()))
        .unwrap();
    let token = grant["sessionId"].as_str().unwrap();
    assert_eq!(host.status(token).unwrap()["nextStep"], "second");
    assert!(
        host.step_with(token, "first", None, |_, _, _| panic!(
            "replayed completed effect"
        ))
        .is_err()
    );
    assert_eq!(
        journal::Store::new(root.path().to_owned())
            .claim(&saved)
            .err()
            .unwrap(),
        "BLK-RPA-JOURNAL-003"
    );
    host.step_with(token, "second", None, |_, _, _| Ok(json!({"found":true})))
        .unwrap();
    assert_eq!(host.status(token).unwrap()["status"], "completed");
    assert_eq!(
        host.status(token).unwrap()["receipts"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
}
#[test]
fn recovery_requires_all_effect_checks_and_rejects_uncertain_or_live_owner() {
    let root = journal_directory();
    let mut saved = exited_owner_snapshot(root.path());
    let mut request = recovery::Request {
        schema_version: "blocky.rpa-recovery/v1".into(),
        checkpoint_id: saved.checkpoint_id.clone(),
        revision: saved.revision,
        checks: vec![],
    };
    assert_eq!(
        request.validate(&saved).unwrap_err(),
        "BLK-RPA-RECOVERY-003"
    );
    request.checks.push(recovery::Check {
        step_id: "first".into(),
        locator: prepared().plan.steps[1].locator.clone(),
        expected_text: None,
    });
    request.validate(&saved).unwrap();
    request.checks.push(request.checks[0].clone());
    assert!(request.validate(&saved).is_err());
    saved.receipts[0].status = "uncertain".into();
    assert_eq!(
        recovery::eligible(&saved).unwrap_err(),
        "BLK-RPA-RECEIPT-002"
    );
    saved.receipts[0].status = "completed".into();
    saved.owner = Some(owner::Owner::current().unwrap());
    assert_eq!(
        recovery::eligible(&saved).unwrap_err(),
        "BLK-RPA-RECOVERY-001"
    );
    saved.owner = None;
    assert_eq!(
        recovery::eligible(&saved).unwrap_err(),
        "BLK-RPA-RECOVERY-001"
    );
}
#[test]
fn rejects_forged_grant_out_of_order_and_duplicate_effect() {
    let host = RpaHost::default();
    let token = grant(&host);
    assert_eq!(
        host.step("forged", "first", None).unwrap_err(),
        "BLK-RPA-PERM-001"
    );
    assert_eq!(
        host.step_with(&token, "second", None, |_, _, _| panic!("out of order"))
            .unwrap_err(),
        "BLK-RPA-STEP-001"
    );
    host.step_with(&token, "first", None, |_, _, _| Ok(json!({"invoked":true})))
        .unwrap();
    assert_eq!(
        host.step_with(&token, "first", None, |_, _, _| panic!("replayed"))
            .unwrap_err(),
        "BLK-RPA-STEP-001"
    );
    assert_eq!(
        host.status(&token).unwrap()["receipts"][0]["status"],
        "completed"
    );
}
#[test]
fn uncertain_effect_is_retained_after_failure_and_cannot_replay() {
    let host = RpaHost::default();
    let token = grant(&host);
    assert!(
        host.step_with(&token, "first", None, |_, _, _| Err(
            "BLK-RPA-TIMEOUT-001".into()
        ))
        .is_err()
    );
    assert_eq!(
        host.status(&token).unwrap()["receipts"][0]["status"],
        "uncertain"
    );
    assert!(
        host.step_with(&token, "first", None, |_, _, _| panic!("uncertain replay"))
            .is_err()
    );
}
#[test]
fn stop_waits_for_inflight_settlement_and_retains_uncertain_receipt() {
    let host = Arc::new(RpaHost::default());
    let token = grant(&host);
    let (started, ready) = std::sync::mpsc::channel();
    let worker = host.clone();
    let worker_token = token.clone();
    let join = std::thread::spawn(move || {
        worker.step_with(&worker_token, "first", None, |_, _, cancel| {
            started.send(()).unwrap();
            while !cancel.load(Ordering::SeqCst) {
                std::thread::sleep(Duration::from_millis(5));
            }
            std::thread::sleep(Duration::from_millis(60));
            Err("BLK-RPA-CANCELLED".into())
        })
    });
    ready.recv_timeout(Duration::from_secs(1)).unwrap();
    host.stop(&token).unwrap();
    assert!(join.join().unwrap().is_err());
    let state = host.status(&token).unwrap();
    assert_eq!(state["active"], false);
    assert_eq!(state["status"], "stopped");
    assert_eq!(state["receipts"][0]["status"], "uncertain");
}
#[test]
fn expiry_and_shutdown_revoke_capabilities() {
    let host = RpaHost::default();
    let token = grant(&host);
    host.slot(&token).unwrap().state.lock().unwrap().expires = 0;
    assert_eq!(
        host.step_with(&token, "first", None, |_, _, _| panic!("expired"))
            .unwrap_err(),
        "BLK-RPA-PERM-001"
    );
    host.shutdown().unwrap();
    assert!(host.insert(prepared()).is_err());
    assert!(target::inspect(0).is_err());
}
#[test]
fn settlement_failure_is_not_overwritten_by_cancel_or_shutdown() {
    let host = RpaHost::default();
    let token = grant(&host);
    let result = host.step_with(&token, "first", None, |_, _, cancel| {
        cancel.store(true, Ordering::SeqCst);
        Err("BLK-RPA-SETTLEMENT-001".into())
    });
    assert_eq!(result.unwrap_err(), "BLK-RPA-SETTLEMENT-001");
    assert_eq!(host.status(&token).unwrap()["active"], true);
    assert_eq!(host.stop(&token).unwrap_err(), "BLK-RPA-SETTLEMENT-001");
    assert!(host.shutdown().is_err());
}
#[test]
fn rpa_cannot_resolve_provider_secret_references() {
    let mut p = prepared().plan;
    p.steps[0].action = Action::Fill;
    p.steps[0].value = Some(protocol::InputRef {
        kind: "secret-ref".into(),
        reference: Some("provider-key".into()),
    });
    assert!(matches!(preflight(p),Err(code) if code=="BLK-RPA-SENSITIVE-001"));
}
#[test]
fn worker_entry() {
    if std::env::var("BLOCKY_RPA_TEST_WORKER").as_deref() != Ok("1") {
        return;
    }
    use std::io::BufRead;
    let mut line = String::new();
    std::io::stdin().lock().read_line(&mut line).unwrap();
    if let Ok(input) = serde_json::from_str::<worker::Input>(&line) {
        if input.approval.is_some() {
            let _ = worker::execute(&input);
            std::process::exit(0);
        }
    }
    std::thread::sleep(Duration::from_secs(60));
    std::process::exit(0);
}
#[test]
fn hung_worker_is_terminated_before_timeout_returns() {
    let p = prepared();
    let start = std::time::Instant::now();
    let error = process::run(
        &worker::Input {
            target: p.target,
            root_id: None,
            step: None,
            input: None,
            approval: None,
        },
        150,
        Arc::new(AtomicBool::new(false)),
    )
    .unwrap_err();
    assert_eq!(error, "BLK-RPA-TIMEOUT-001");
    assert!(start.elapsed() < Duration::from_secs(5));
}
#[test]
fn pause_before_step_waits_until_resumed_and_does_not_fail_the_run() {
    let host = Arc::new(RpaHost::default());
    let token = grant(&host);
    host.pause(&token).unwrap();
    let task_host = host.clone();
    let task_token = token.clone();
    let called = Arc::new(AtomicBool::new(false));
    let callback = called.clone();
    let join = std::thread::spawn(move || {
        task_host.step_with(&task_token, "first", None, |_, _, _| {
            callback.store(true, Ordering::SeqCst);
            Ok(json!({}))
        })
    });
    std::thread::sleep(Duration::from_millis(40));
    assert!(!called.load(Ordering::SeqCst));
    // Fixture has no OS target; resume's real target verification is tested separately.
    let slot = host.slot(&token).unwrap();
    slot.state.lock().unwrap().status = "ready";
    slot.settled.notify_all();
    join.join().unwrap().unwrap();
    assert!(called.load(Ordering::SeqCst));
}
#[test]
fn cancellation_before_authorization_dispatch_prevents_late_grant() {
    let host = RpaHost::default();
    host.cancel_authorization("delayed").unwrap();
    assert_eq!(
        host.authorize_attended("delayed", prepared().plan)
            .unwrap_err(),
        "BLK-RPA-CANCELLED"
    );
    assert!(host.sessions.lock().unwrap().is_empty());
}
#[test]
fn late_authorization_cancel_revokes_the_already_created_grant() {
    let host = RpaHost::default();
    let token = grant(&host);
    host.approvals.lock().unwrap().insert(
        "request".into(),
        Arc::new(Approval {
            cancel: Arc::new(AtomicBool::new(false)),
            active: AtomicBool::new(false),
            unsettled: AtomicBool::new(false),
            grant: Mutex::new(Some(token.clone())),
            expires: now() + 600000,
        }),
    );
    host.cancel_authorization("request").unwrap();
    assert_eq!(host.status(&token).unwrap()["status"], "stopped");
    assert!(
        host.step_with(&token, "first", None, |_, _, _| panic!("cancelled grant"))
            .is_err()
    );
    assert_eq!(
        host.authorize_attended("request", prepared().plan)
            .unwrap_err(),
        "BLK-RPA-CANCELLED"
    );
    assert!(host.approvals.lock().unwrap().contains_key("request"));
}
#[test]
fn shutdown_cancels_other_sessions_even_when_one_approval_cannot_settle() {
    let host = Arc::new(RpaHost::default());
    let token = grant(&host);
    host.approvals.lock().unwrap().insert(
        "broken".into(),
        Arc::new(Approval {
            cancel: Arc::new(AtomicBool::new(false)),
            active: AtomicBool::new(false),
            unsettled: AtomicBool::new(true),
            grant: Mutex::new(None),
            expires: now() + 600000,
        }),
    );
    let task = host.clone();
    let task_token = token.clone();
    let (send, recv) = std::sync::mpsc::channel();
    let join = std::thread::spawn(move || {
        task.step_with(&task_token, "first", None, |_, _, cancel| {
            send.send(()).unwrap();
            while !cancel.load(Ordering::SeqCst) {
                std::thread::sleep(Duration::from_millis(5));
            }
            Err("BLK-RPA-CANCELLED".into())
        })
    });
    recv.recv_timeout(Duration::from_secs(1)).unwrap();
    assert_eq!(host.shutdown().unwrap_err(), "BLK-RPA-SETTLEMENT-001");
    assert!(join.join().unwrap().is_err());
    assert_eq!(host.status(&token).unwrap()["active"], false);
}
