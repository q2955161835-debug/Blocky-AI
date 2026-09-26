use super::{Store, execution::Execution};
use serde_json::json;
use std::os::windows::process::CommandExt;
use std::{
    ffi::OsString,
    io::{BufRead, BufReader, Write},
    process::{Command, Stdio},
    sync::mpsc,
    time::Duration,
};

fn definition() -> serde_json::Value {
    json!({"projectId":"project-execution","moduleId":"main","blockId":"flow","planDigest":"a".repeat(64),"runtimeVersion":1,
        "steps":[{"stepId":"effect","kind":"action","compensate":false}]})
}

#[test]
fn desktop_reconciliation_reads_back_settled_outcomes_and_rejects_shutdown() {
    for outcome in ["not-executed", "completed"] {
        let dir = temp();
        let store = Store::new(dir.path().to_owned()).unwrap();
        let host = super::host::WorkflowHost::new(dir.path().to_owned());
        store
            .create("task-desktop-check", &definition(), json!(null))
            .unwrap();
        let mut lease = store
            .acquire("task-desktop-check", &definition(), 1)
            .unwrap();
        let mut executor = worker();
        lease.bind_execution(&mut executor).unwrap();
        executor.resume().unwrap();
        lease.commit(&json!({"kind":"begin","revision":1})).unwrap();
        let mut request = json!({"schemaVersion":"blocky.project-io/v1alpha1","operation":"workflow-reconcile",
            "projectId":"project-execution","taskId":"task-desktop-check","revision":2,"stepId":"effect","direction":"forward","outcome":outcome});
        if outcome == "completed" {
            request["state"] = json!({"value":"desktop-private-canary"});
        }
        assert_eq!(host.reconcile(&request).unwrap_err(), "BLK-WORKFLOW-OWNER");
        lease.settle_execution(&executor.stop().unwrap()).unwrap();
        drop(lease);
        let preview = host.reconcile(&request).unwrap();
        assert_eq!(store.read("task-desktop-check").unwrap()["revision"], 2);
        request["approval"] = preview["requestDigest"].clone();
        let applied = host.reconcile(&request).unwrap();
        let readback = host
            .query(
                &json!({"schemaVersion":"blocky.project-io/v1alpha1","operation":"workflow-show",
            "projectId":"project-execution","taskId":"task-desktop-check"}),
            )
            .unwrap();
        assert_eq!(readback, applied["task"]);
        assert_eq!(readback["resolutions"][0]["outcome"], outcome);
        assert!(!readback.to_string().contains("desktop-private-canary"));
        host.shutdown().unwrap();
        assert_eq!(
            host.reconcile(&request).unwrap_err(),
            "BLK-WORKFLOW-CANCELLED"
        );
    }
}

#[test]
fn native_reconciliation_requires_settlement_and_explicit_bound_approval() {
    for outcome in ["not-executed", "completed"] {
        let dir = temp();
        let store = Store::new(dir.path().to_owned()).unwrap();
        let secret = "reconcile-private-state-canary";
        store
            .create("task-reconcile", &definition(), json!({"value":secret}))
            .unwrap();
        let mut lease = store.acquire("task-reconcile", &definition(), 1).unwrap();
        let mut executor = worker();
        lease.bind_execution(&mut executor).unwrap();
        executor.resume().unwrap();
        lease.commit(&json!({"kind":"begin","revision":1})).unwrap();
        let mut request = json!({"schemaVersion":"blocky.project-io/v1alpha1","operation":"workflow-reconcile",
            "projectId":"project-execution","taskId":"task-reconcile","revision":2,"stepId":"effect","direction":"forward","outcome":outcome});
        if outcome == "completed" {
            request["state"] = json!({"value":secret,"checked":true});
        }
        assert_eq!(
            super::reconciliation::dispatch(dir.path().to_owned(), &request).unwrap_err(),
            "BLK-WORKFLOW-OWNER"
        );
        let proof = executor.stop().unwrap();
        lease.settle_execution(&proof).unwrap();
        drop(lease);
        let preview = super::reconciliation::dispatch(dir.path().to_owned(), &request).unwrap();
        assert_eq!(preview["applied"], false);
        assert_eq!(store.read("task-reconcile").unwrap()["revision"], 2);
        assert!(!preview.to_string().contains(secret));
        let mut wrong = request.clone();
        wrong["approval"] = json!("f".repeat(64));
        assert_eq!(
            super::reconciliation::dispatch(dir.path().to_owned(), &wrong).unwrap_err(),
            "BLK-WORKFLOW-APPROVAL"
        );
        wrong["approval"] = preview["requestDigest"].clone();
        wrong["direction"] = json!("rollback");
        assert_eq!(
            super::reconciliation::dispatch(dir.path().to_owned(), &wrong).unwrap_err(),
            "BLK-WORKFLOW-BINDING"
        );
        request["approval"] = preview["requestDigest"].clone();
        let mut changed = request.clone();
        changed["projectId"] = json!("project-other");
        assert_eq!(
            super::reconciliation::dispatch(dir.path().to_owned(), &changed).unwrap_err(),
            "BLK-WORKFLOW-BINDING"
        );
        if outcome == "completed" {
            changed = request.clone();
            changed["state"] = json!({"changed":true});
            assert_eq!(
                super::reconciliation::dispatch(dir.path().to_owned(), &changed).unwrap_err(),
                "BLK-WORKFLOW-APPROVAL"
            );
        }
        let result = super::reconciliation::dispatch(dir.path().to_owned(), &request).unwrap();
        assert_eq!(result["applied"], true);
        assert_eq!(result["task"]["revision"], 3);
        assert!(!result.to_string().contains(secret));
        assert_eq!(result["task"]["resolutions"][0]["outcome"], outcome);
        assert_eq!(
            result["task"]["cursor"],
            if outcome == "completed" { 1 } else { 0 }
        );
        assert!(store.execution("task-reconcile").unwrap().is_none());
        assert_eq!(
            store.read("task-reconcile").unwrap()["state"]["value"],
            secret
        );
        assert_eq!(
            super::reconciliation::dispatch(dir.path().to_owned(), &request).unwrap_err(),
            "BLK-WORKFLOW-CONFLICT"
        );
        store
            .acquire("task-reconcile", &definition(), 3)
            .unwrap()
            .release()
            .unwrap();
        let bytes = std::fs::read(dir.path().join("task-task-reconcile.bin")).unwrap();
        assert!(!bytes.windows(secret.len()).any(|b| b == secret.as_bytes()));
    }
}

#[test]
fn native_reconciliation_accepts_a_settled_compensation_without_replaying_it() {
    let dir = temp();
    let store = Store::new(dir.path().to_owned()).unwrap();
    let mut plan = definition();
    plan["steps"][0]["compensate"] = json!(true);
    store
        .create("task-undo", &plan, json!({"count":0}))
        .unwrap();
    let mut lease = store.acquire("task-undo", &plan, 1).unwrap();
    let mut executor = worker();
    lease.bind_execution(&mut executor).unwrap();
    executor.resume().unwrap();
    lease.commit(&json!({"kind":"begin","revision":1})).unwrap();
    lease
        .commit(&json!({"kind":"complete","revision":2,"state":{"count":1}}))
        .unwrap();
    lease
        .commit(&json!({"kind":"rollback","revision":3}))
        .unwrap();
    lease.commit(&json!({"kind":"begin","revision":4})).unwrap();
    lease.settle_execution(&executor.stop().unwrap()).unwrap();
    drop(lease);
    let mut request = json!({"schemaVersion":"blocky.project-io/v1alpha1","operation":"workflow-reconcile",
        "projectId":"project-execution","taskId":"task-undo","revision":5,"stepId":"effect","direction":"rollback","outcome":"completed","state":{"count":0}});
    let preview = super::reconciliation::dispatch(dir.path().to_owned(), &request).unwrap();
    request["approval"] = preview["requestDigest"].clone();
    let result = super::reconciliation::dispatch(dir.path().to_owned(), &request).unwrap();
    assert_eq!(result["task"]["cursor"], -1);
    assert_eq!(result["task"]["receipts"][0]["status"], "compensated");
    let mut lease = store.acquire("task-undo", &plan, 6).unwrap();
    assert_eq!(
        lease
            .commit(&json!({"kind":"finish","revision":6}))
            .unwrap()["status"],
        "compensated"
    );
    lease.release().unwrap();
}

#[test]
fn native_reconciliation_rejects_missing_or_unsettled_execution_and_hidden_fields() {
    for bound in [false, true] {
        let dir = temp();
        let store = Store::new(dir.path().to_owned()).unwrap();
        store
            .create("task-reconcile", &definition(), json!(null))
            .unwrap();
        let mut lease = store.acquire("task-reconcile", &definition(), 1).unwrap();
        let mut executor = worker();
        if bound {
            lease.bind_execution(&mut executor).unwrap();
            executor.resume().unwrap();
        }
        lease.commit(&json!({"kind":"begin","revision":1})).unwrap();
        if bound {
            let _ = executor.stop().unwrap();
        }
        drop(lease);
        let request = json!({"schemaVersion":"blocky.project-io/v1alpha1","operation":"workflow-reconcile",
            "projectId":"project-execution","taskId":"task-reconcile","revision":2,"stepId":"effect","direction":"forward","outcome":"not-executed"});
        assert_eq!(
            super::reconciliation::dispatch(dir.path().to_owned(), &request).unwrap_err(),
            "BLK-WORKFLOW-UNCERTAIN"
        );
        for field in ["settled", "owner", "state"] {
            let mut hidden = request.clone();
            hidden[field] = json!(true);
            assert_eq!(
                super::reconciliation::dispatch(dir.path().to_owned(), &hidden).unwrap_err(),
                "BLK-WORKFLOW-INVALID"
            );
        }
    }
}

#[test]
fn native_reconciliation_cli_uses_private_state_file_and_public_summary_only() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .parent()
        .unwrap();
    let dir = temp();
    let profile = dir.path().join("profile");
    let store = Store::new(profile.join("workflow")).unwrap();
    for outcome in ["not-executed", "completed"] {
        let task = format!("task-{outcome}");
        store
            .create(
                &task,
                &definition(),
                json!({"private":"reconcile-cli-canary"}),
            )
            .unwrap();
        let mut lease = store.acquire(&task, &definition(), 1).unwrap();
        let mut executor = worker();
        lease.bind_execution(&mut executor).unwrap();
        executor.resume().unwrap();
        lease.commit(&json!({"kind":"begin","revision":1})).unwrap();
        lease.settle_execution(&executor.stop().unwrap()).unwrap();
        drop(lease);
        let state = dir.path().join("checked-state.json");
        std::fs::write(
            &state,
            br#"{"private":"reconcile-cli-canary","confirmed":true}"#,
        )
        .unwrap();
        let mut args = vec![
            "workflow".to_string(),
            "reconcile".into(),
            task.clone(),
            "--project-id".into(),
            "project-execution".into(),
            "--revision".into(),
            "2".into(),
            "--step".into(),
            "effect".into(),
            "--direction".into(),
            "forward".into(),
            "--outcome".into(),
            outcome.into(),
            "--json".into(),
        ];
        if outcome == "completed" {
            args.extend(["--state".into(), state.to_string_lossy().into_owned()]);
        }
        let call = |args: &[String]| {
            let result = Command::new(root.join("try/stage5/builder-runtime/node.exe"))
                .arg(root.join("tools/blocky-cli/dist/main.mjs"))
                .args(args)
                .env("BLOCKY_PROFILE_DIR", &profile)
                .creation_flags(0x08000000)
                .output()
                .unwrap();
            let text = String::from_utf8(result.stdout).unwrap();
            assert!(!text.contains("reconcile-cli-canary"));
            let value: serde_json::Value =
                serde_json::from_str(text.lines().last().unwrap()).unwrap();
            assert!(result.status.success(), "{value}");
            value["data"].clone()
        };
        let preview = call(&args);
        assert_eq!(preview["applied"], false);
        args.extend([
            "--approve".into(),
            preview["requestDigest"].as_str().unwrap().into(),
        ]);
        let applied = call(&args);
        assert_eq!(applied["applied"], true);
        assert_eq!(applied["task"]["revision"], 3);
        assert_eq!(
            store.read(&task).unwrap()["state"]["private"],
            "reconcile-cli-canary"
        );
        assert_eq!(
            store.read(&task).unwrap()["state"]
                .get("confirmed")
                .is_some(),
            outcome == "completed"
        );
    }
}
fn worker() -> Execution {
    Execution::spawn(
        &std::env::current_exe().unwrap(),
        &[
            OsString::from("--exact"),
            OsString::from("workflow::execution_tests::native_worker_probe"),
            OsString::from("--ignored"),
            OsString::from("--nocapture"),
        ],
    )
    .unwrap()
}
fn temp() -> tempfile::TempDir {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .parent()
        .unwrap()
        .join("try");
    tempfile::tempdir_in(root).unwrap()
}
fn start_tree(worker: &mut Execution) -> Vec<crate::process_identity::Identity> {
    let output = worker.take_stdout().unwrap();
    let (tx, rx) = mpsc::channel();
    let reader = std::thread::spawn(move || {
        for line in BufReader::new(output).lines().map_while(Result::ok) {
            if let Some(value) = line.strip_prefix("OWNED ") {
                let _ = tx.send(value.to_owned());
                break;
            }
        }
    });
    worker.resume().unwrap();
    worker.stdin().unwrap().write_all(b"spawn\n").unwrap();
    let identities =
        serde_json::from_str(&rx.recv_timeout(Duration::from_secs(10)).unwrap()).unwrap();
    reader.join().unwrap();
    identities
}
#[test]
fn native_execution_binds_before_start_and_proves_real_worker_tree_settlement() {
    let dir = temp();
    let store = Store::new(dir.path().to_owned()).unwrap();
    store
        .create("task-owned", &definition(), json!(null))
        .unwrap();
    let mut lease = store.acquire("task-owned", &definition(), 1).unwrap();
    let mut worker = worker();
    assert_eq!(worker.resume().unwrap_err(), "BLK-WORKFLOW-OWNER");
    let output = worker.take_stdout().unwrap();
    let (tx, rx) = mpsc::channel();
    let reader = std::thread::spawn(move || {
        for line in BufReader::new(output).lines().map_while(Result::ok) {
            if let Some(value) = line.strip_prefix("OWNED ") {
                tx.send(value.to_owned()).unwrap();
            }
        }
    });
    assert!(rx.recv_timeout(Duration::from_millis(50)).is_err());
    lease.bind_execution(&mut worker).unwrap();
    worker.resume().unwrap();
    worker.stdin().unwrap().write_all(b"spawn\n").unwrap();
    let identities: Vec<crate::process_identity::Identity> =
        serde_json::from_str(&rx.recv_timeout(Duration::from_secs(10)).unwrap()).unwrap();
    assert_eq!(identities.len(), 2);
    assert!(identities.iter().all(|p| p.is_alive().unwrap()));
    assert!(!store.execution("task-owned").unwrap().unwrap().settled());
    lease.commit(&json!({"kind":"begin","revision":1})).unwrap();
    let proof = worker.stop().unwrap();
    assert!(identities.iter().all(|p| !p.is_alive().unwrap()));
    reader.join().unwrap();
    lease.settle_execution(&proof).unwrap();
    assert!(
        Store::new(dir.path().to_owned())
            .unwrap()
            .execution("task-owned")
            .unwrap()
            .unwrap()
            .settled()
    );
    // Stopping the local executor never resolves the business effect or authorizes replay.
    assert_eq!(store.read("task-owned").unwrap()["status"], "executing");
    assert_eq!(
        lease
            .commit(&json!({"kind":"resolve","revision":2,"outcome":"not-executed"}))
            .unwrap_err(),
        "BLK-WORKFLOW-UNCERTAIN"
    );
    assert_eq!(lease.release().unwrap_err(), "BLK-WORKFLOW-UNCERTAIN");
}
#[test]
#[ignore = "Owned process fixture; invoked only by native execution tests"]
fn native_worker_probe() {
    let mut input = String::new();
    std::io::stdin().read_line(&mut input).unwrap();
    assert_eq!(input.trim(), "spawn");
    let mut child = Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "workflow::execution_tests::native_grandchild_probe",
            "--ignored",
            "--nocapture",
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .creation_flags(0x08000000)
        .spawn()
        .unwrap();
    let mut grandchild = None;
    for line in BufReader::new(child.stdout.take().unwrap())
        .lines()
        .map_while(Result::ok)
    {
        if let Some(value) = line.strip_prefix("IDENTITY ") {
            grandchild =
                Some(serde_json::from_str::<crate::process_identity::Identity>(value).unwrap());
            break;
        }
    }
    println!(
        "OWNED {}",
        serde_json::to_string(&vec![
            crate::process_identity::Identity::current().unwrap(),
            grandchild.unwrap()
        ])
        .unwrap()
    );
    std::io::stdout().flush().unwrap();
    loop {
        std::thread::sleep(Duration::from_secs(1));
    }
}

#[test]
fn native_execution_rejects_foreign_proofs_rebinding_and_post_stop_effects() {
    let dir = temp();
    let store = Store::new(dir.path().to_owned()).unwrap();
    for id in ["task-first", "task-second"] {
        store.create(id, &definition(), json!(null)).unwrap();
    }
    let mut first = store.acquire("task-first", &definition(), 1).unwrap();
    let mut second = store.acquire("task-second", &definition(), 1).unwrap();
    let mut a = worker();
    let mut b = worker();
    first.bind_execution(&mut a).unwrap();
    assert_eq!(
        second.bind_execution(&mut a).unwrap_err(),
        "BLK-WORKFLOW-OWNER"
    );
    second.bind_execution(&mut b).unwrap();
    let proof = a.stop().unwrap();
    assert_eq!(a.resume().unwrap_err(), "BLK-WORKFLOW-OWNER");
    assert_eq!(
        second.settle_execution(&proof).unwrap_err(),
        "BLK-WORKFLOW-OWNER"
    );
    assert!(!store.execution("task-second").unwrap().unwrap().settled());
    first.settle_execution(&proof).unwrap();
    assert_eq!(
        first
            .commit(&json!({"kind":"begin","revision":1}))
            .unwrap_err(),
        "BLK-WORKFLOW-OWNER"
    );
    first.release().unwrap();
    assert!(store.execution("task-first").unwrap().is_none());
    // Even the same task cannot reuse a former lease's proof.
    let mut renewed = store.acquire("task-first", &definition(), 1).unwrap();
    let mut c = worker();
    renewed.bind_execution(&mut c).unwrap();
    assert_eq!(
        renewed.settle_execution(&proof).unwrap_err(),
        "BLK-WORKFLOW-OWNER"
    );
    renewed.settle_execution(&c.stop().unwrap()).unwrap();
    renewed.release().unwrap();
    second.settle_execution(&b.stop().unwrap()).unwrap();
    second.release().unwrap();
}

#[test]
fn native_execution_requires_settlement_before_release_and_does_not_forge_it_on_drop() {
    let dir = temp();
    let store = Store::new(dir.path().to_owned()).unwrap();
    store
        .create("task-drop", &definition(), json!(null))
        .unwrap();
    let mut lease = store.acquire("task-drop", &definition(), 1).unwrap();
    let mut worker = worker();
    lease.bind_execution(&mut worker).unwrap();
    let identities = start_tree(&mut worker);
    assert_eq!(identities.len(), 2);
    assert!(identities.iter().all(|p| p.is_alive().unwrap()));
    assert_eq!(lease.release().unwrap_err(), "BLK-WORKFLOW-UNCERTAIN");
    drop(worker);
    assert!(identities.iter().all(|p| !p.is_alive().unwrap()));
    assert!(
        !Store::new(dir.path().to_owned())
            .unwrap()
            .execution("task-drop")
            .unwrap()
            .unwrap()
            .settled()
    );
    assert!(store.acquire("task-drop", &definition(), 1).is_err());
    assert_eq!(store.read("task-drop").unwrap()["revision"], 1);
}

#[test]
fn native_execution_cannot_bind_after_effect_begin_or_accept_json_claims() {
    let dir = temp();
    let store = Store::new(dir.path().to_owned()).unwrap();
    store
        .create("task-active", &definition(), json!(null))
        .unwrap();
    assert!(store.execution("task-active").unwrap().is_none());
    let mut lease = store.acquire("task-active", &definition(), 1).unwrap();
    let mut worker = worker();
    lease.commit(&json!({"kind":"begin","revision":1})).unwrap();
    assert_eq!(
        lease.bind_execution(&mut worker).unwrap_err(),
        "BLK-WORKFLOW-OWNER"
    );
    assert_eq!(worker.resume().unwrap_err(), "BLK-WORKFLOW-OWNER");
    assert!(
        lease
            .commit(&json!({"kind":"complete","revision":2,"state":null,"settled":true}))
            .is_err()
    );
    assert_eq!(store.read("task-active").unwrap()["status"], "executing");
    assert!(store.execution("task-active").unwrap().is_none());
}

#[test]
fn native_runtime_bootstrap_shares_custody_but_keeps_each_task_receipt_bound() {
    let dir = temp();
    let store = Store::new(dir.path().to_owned()).unwrap();
    let mut root = worker();
    root.bootstrap().unwrap();
    let mut views = Vec::new();
    for id in ["task-one", "task-two"] {
        store.create(id, &definition(), json!(null)).unwrap();
        let mut lease = store.acquire(id, &definition(), 1).unwrap();
        let mut view = root.task_view().unwrap();
        lease.bind_execution(&mut view).unwrap();
        views.push((lease, view));
    }
    let mut late = root.task_view().unwrap();
    root.settle_process().unwrap();
    store
        .create("task-late", &definition(), json!(null))
        .unwrap();
    let mut late_lease = store.acquire("task-late", &definition(), 1).unwrap();
    assert_eq!(
        late_lease.bind_execution(&mut late).unwrap_err(),
        "BLK-WORKFLOW-OWNER"
    );
    late_lease.release().unwrap();
    let proof = views[0].1.stop().unwrap();
    assert_eq!(
        views[1].0.settle_execution(&proof).unwrap_err(),
        "BLK-WORKFLOW-OWNER"
    );
    for (mut lease, mut view) in views {
        lease.settle_execution(&view.stop().unwrap()).unwrap();
        lease.release().unwrap();
    }
    assert!(root.task_view().is_err());
}

#[test]
fn native_execution_owner_exit_without_receipt_does_not_unlock_boundary() {
    let dir = temp();
    let output = Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "workflow::execution_tests::native_owner_exit_probe",
            "--ignored",
            "--nocapture",
        ])
        .env("BLOCKY_EXECUTION_TEST_ROOT", dir.path())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .creation_flags(0x08000000)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let store = Store::new(dir.path().to_owned()).unwrap();
    assert!(!store.execution("task-orphan").unwrap().unwrap().settled());
    assert_eq!(store.read("task-orphan").unwrap()["revision"], 1);
    assert_eq!(
        store
            .acquire("task-orphan", &definition(), 1)
            .err()
            .unwrap(),
        "BLK-WORKFLOW-UNCERTAIN"
    );
}

#[test]
#[ignore = "Native coordinator exit fixture"]
fn native_owner_exit_probe() {
    let store = Store::new(
        std::env::var_os("BLOCKY_EXECUTION_TEST_ROOT")
            .unwrap()
            .into(),
    )
    .unwrap();
    store
        .create("task-orphan", &definition(), json!(null))
        .unwrap();
    let mut lease = store.acquire("task-orphan", &definition(), 1).unwrap();
    let mut worker = worker();
    lease.bind_execution(&mut worker).unwrap();
    // Simulate native owner loss before either a business intent or stopped receipt.
    std::process::exit(0);
}

#[test]
fn native_worker_rejects_existing_job_without_terminating_its_processes() {
    let name = format!("Local\\Blocky-Collision-{}", uuid::Uuid::new_v4());
    let first = crate::process_job::Job::named(&name).unwrap();
    let mut child = Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "workflow::execution_tests::native_grandchild_probe",
            "--ignored",
            "--nocapture",
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .creation_flags(0x08000000)
        .spawn()
        .unwrap();
    use std::os::windows::io::AsRawHandle;
    first.assign(child.as_raw_handle() as _).unwrap();
    assert_eq!(
        crate::process_job::Job::named(&name).err().unwrap(),
        "BLK-WORKFLOW-OWNER"
    );
    assert!(child.try_wait().unwrap().is_none());
    assert!(first.settle());
    assert!(child.try_wait().unwrap().is_some());
}
#[test]
#[ignore = "Owned descendant fixture; invoked only by native execution tests"]
fn native_grandchild_probe() {
    println!(
        "IDENTITY {}",
        serde_json::to_string(&crate::process_identity::Identity::current().unwrap()).unwrap()
    );
    std::io::stdout().flush().unwrap();
    loop {
        std::thread::sleep(Duration::from_secs(1));
    }
}

#[test]
fn native_worker_quotes_arguments_and_excludes_unrelated_inheritable_handles() {
    use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
    use windows_sys::Win32::{
        Foundation::WAIT_TIMEOUT, Security::SECURITY_ATTRIBUTES, System::Threading::*,
    };
    let attributes = SECURITY_ATTRIBUTES {
        nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
        lpSecurityDescriptor: std::ptr::null_mut(),
        bInheritHandle: 1,
    };
    let handle = unsafe { CreateEventW(&attributes, 1, 0, std::ptr::null()) };
    assert!(!handle.is_null());
    let event = unsafe { OwnedHandle::from_raw_handle(handle as _) };
    let expected = [
        "",
        "two words",
        "中文路径",
        "with\"quote",
        "trailing\\",
        "two\\\\\"slashes",
        "space tail\\",
    ];
    let mut args: Vec<OsString> = [
        "--exact",
        "workflow::execution_tests::native_arguments_probe",
        "--ignored",
        "--nocapture",
    ]
    .into_iter()
    .map(OsString::from)
    .collect();
    args.extend(expected.iter().map(OsString::from));
    let mut worker = crate::process_worker::Worker::spawn(
        &std::env::current_exe().unwrap(),
        &args,
        &format!("Local\\Blocky-Test-{}", uuid::Uuid::new_v4()),
    )
    .unwrap();
    let output = worker.take_output().unwrap();
    let (tx, rx) = mpsc::channel();
    let reader = std::thread::spawn(move || {
        for line in BufReader::new(output).lines().map_while(Result::ok) {
            if let Some(value) = line.strip_prefix("ARGS ") {
                let _ = tx.send(value.to_owned());
            }
        }
    });
    worker.resume().unwrap();
    writeln!(
        worker.input().unwrap(),
        "{}",
        event.as_raw_handle() as usize
    )
    .unwrap();
    let actual: Vec<String> =
        serde_json::from_str(&rx.recv_timeout(Duration::from_secs(10)).unwrap()).unwrap();
    worker.stop().unwrap();
    reader.join().unwrap();
    assert_eq!(&actual[5..], &expected);
    assert_eq!(unsafe { WaitForSingleObject(handle, 0) }, WAIT_TIMEOUT);
}

#[test]
#[ignore = "Private worker argv and inheritance fixture"]
fn native_arguments_probe() {
    let mut input = String::new();
    std::io::stdin().read_line(&mut input).unwrap();
    let handle = input.trim().parse::<usize>().unwrap();
    unsafe {
        windows_sys::Win32::System::Threading::SetEvent(handle as _);
    }
    println!(
        "ARGS {}",
        serde_json::to_string(&std::env::args().collect::<Vec<_>>()).unwrap()
    );
    std::io::stdout().flush().unwrap();
}
