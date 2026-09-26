use super::*;
use serde_json::{Value, json};

#[test]
fn workflow_host_matches_shared_typescript_transition_and_summary_fixtures() {
    let cases: Value =
        serde_json::from_str(include_str!("../../tests/fixtures/workflow-parity.json")).unwrap();
    for case in cases.as_array().unwrap() {
        let mut record = parse(&case["initial"]).unwrap();
        for step in case["steps"].as_array().unwrap() {
            record = transition(&record, &step["action"]).unwrap();
            assert_eq!(record, step["after"], "{}", case["name"]);
            assert_eq!(
                summary(&record).unwrap(),
                step["summary"],
                "{}",
                case["name"]
            );
        }
    }
}

fn definition() -> Value {
    json!({"projectId":"project-one","moduleId":"module-one","blockId":"workflow-one",
        "planDigest":"a".repeat(64),"runtimeVersion":1,"steps":[
        {"stepId":"write","kind":"action","compensate":true},
        {"stepId":"review","kind":"approval","label":"Confirm"},
        {"stepId":"save","kind":"checkpoint"}]})
}
fn temp() -> tempfile::TempDir {
    let base = std::path::absolute(
        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../try/stage7/workflow-host-tests"),
    )
    .unwrap();
    std::fs::create_dir_all(&base).unwrap();
    tempfile::tempdir_in(base).unwrap()
}
fn next(record: &Value, mut action: Value) -> Value {
    action["revision"] = record["revision"].clone();
    transition(record, &action).unwrap()
}
#[test]
fn workflow_host_transitions_preserve_null_frames_and_reverse_compensation() {
    let mut r = create("task-one", &definition(), Value::Null).unwrap();
    r = next(&r, json!({"kind":"begin"}));
    r = next(&r, json!({"kind":"complete","state":{"private":"payload"}}));
    assert!(r["receipts"][0].as_object().unwrap().contains_key("before"));
    assert_eq!(r["receipts"][0]["before"], Value::Null);
    r = next(&r, json!({"kind":"await-approval"}));
    r = next(
        &r,
        json!({"kind":"decide","stepId":"review","decision":"reject"}),
    );
    assert_eq!(r["cursor"], 0);
    r = next(&r, json!({"kind":"begin"}));
    assert_eq!(r["active"]["effectKey"], "task-one:write:rollback");
    r = next(&r, json!({"kind":"complete","state":null}));
    r = next(&r, json!({"kind":"finish"}));
    assert_eq!(r["status"], "compensated");
    let safe = summary(&r).unwrap().to_string();
    assert!(!safe.contains("payload") && !safe.contains("Confirm") && !safe.contains("before"));
    let mut forged = r;
    forged["receipts"][1]["status"] = json!("approved");
    assert!(parse(&forged).is_err());
}
#[test]
fn workflow_host_rejects_injected_fields_codes_conflicts_and_limits() {
    let r = create("task-one", &definition(), json!({})).unwrap();
    assert_eq!(
        transition(&r, &json!({"kind":"begin","revision":2})).unwrap_err(),
        "BLK-WORKFLOW-CONFLICT"
    );
    assert!(transition(&r, &json!({"kind":"begin","revision":1,"owner":true})).is_err());
    let mut active = next(&r, json!({"kind":"begin"}));
    assert!(
        transition(
            &active,
            &json!({"kind":"uncertain","revision":2,"code":"BLK-WORKFLOW-SECRET"})
        )
        .is_err()
    );
    active["status"] = json!("uncertain");
    active["code"] = json!("BLK-WORKFLOW-SECRET");
    assert!(parse(&active).is_err());
    assert!(create("task-one", &definition(), json!("x".repeat(131072))).is_err());
    let mut deep = Value::Null;
    for _ in 0..34 {
        deep = json!([deep]);
    }
    assert!(create("task-one", &definition(), deep).is_err());
    let mut unexpected = r;
    unexpected["active"] = Value::Null;
    assert!(parse(&unexpected).is_err());
}
#[test]
fn workflow_host_disk_encryption_binding_and_cas() {
    let dir = temp();
    let store = Store::new(dir.path().to_owned()).unwrap();
    store
        .create(
            "task-one",
            &definition(),
            json!({"private":"workflow-test-canary"}),
        )
        .unwrap();
    let mut lease = store.acquire("task-one", &definition(), 1).unwrap();
    assert!(store.acquire("task-one", &definition(), 1).is_err());
    let active = lease.commit(&json!({"kind":"begin","revision":1})).unwrap();
    assert_eq!(active["status"], "executing");
    assert_eq!(
        lease
            .commit(&json!({"kind":"complete","revision":1,"state":null}))
            .unwrap_err(),
        "BLK-WORKFLOW-CONFLICT"
    );
    assert!(
        lease
            .commit(&json!({"kind":"resolve","revision":2,"outcome":"not-executed"}))
            .is_err()
    );
    lease
        .commit(&json!({"kind":"complete","revision":2,"state":null}))
        .unwrap();
    lease.release().unwrap();
    let bytes = std::fs::read(dir.path().join("task-task-one.bin")).unwrap();
    assert!(
        !bytes
            .windows(b"workflow-test-canary".len())
            .any(|v| v == b"workflow-test-canary")
    );
    let other = temp();
    let other_store = Store::new(other.path().to_owned()).unwrap();
    std::fs::copy(
        dir.path().join("task-task-one.bin"),
        other.path().join("task-task-one.bin"),
    )
    .unwrap();
    assert!(other_store.read("task-one").is_err());
    let mut changed = definition();
    changed["planDigest"] = json!("b".repeat(64));
    assert_eq!(
        store.acquire("task-one", &changed, 3).err().unwrap(),
        "BLK-WORKFLOW-BINDING"
    );
    assert_eq!(store.read("task-one").unwrap()["revision"], 3);
    std::fs::write(dir.path().join("task-task-one.bin"), b"corrupt").unwrap();
    assert!(store.read("task-one").is_err());
    assert!(
        store
            .create("../escape", &definition(), Value::Null)
            .is_err()
    );
}
#[test]
fn workflow_host_abandoned_live_owner_and_unknown_effect_are_not_replayed() {
    let dir = temp();
    let store = Store::new(dir.path().to_owned()).unwrap();
    store
        .create("task-one", &definition(), Value::Null)
        .unwrap();
    {
        let _lease = store.acquire("task-one", &definition(), 1).unwrap();
    }
    assert_eq!(
        store.acquire("task-one", &definition(), 1).err().unwrap(),
        "BLK-WORKFLOW-OWNER"
    );
    store
        .create("task-two", &definition(), Value::Null)
        .unwrap();
    let mut lease = store.acquire("task-two", &definition(), 1).unwrap();
    lease.commit(&json!({"kind":"begin","revision":1})).unwrap();
    assert_eq!(lease.release().unwrap_err(), "BLK-WORKFLOW-UNCERTAIN");
    assert_eq!(store.read("task-two").unwrap()["status"], "executing");
}
#[test]
fn workflow_host_two_writers_only_one_revision_wins() {
    let dir = temp();
    let store = Store::new(dir.path().to_owned()).unwrap();
    store
        .create("task-one", &definition(), Value::Null)
        .unwrap();
    let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
    let handles: Vec<_> = (0..2)
        .map(|_| {
            let root = dir.path().to_owned();
            let b = barrier.clone();
            std::thread::spawn(move || {
                let store = Store::new(root).unwrap();
                b.wait();
                let Ok(mut lease) = store.acquire("task-one", &definition(), 1) else {
                    return false;
                };
                lease.commit(&json!({"kind":"pause","revision":1})).unwrap();
                lease.release().unwrap();
                true
            })
        })
        .collect();
    assert_eq!(
        handles
            .into_iter()
            .map(|h| usize::from(h.join().unwrap()))
            .sum::<usize>(),
        1
    );
    assert_eq!(store.read("task-one").unwrap()["revision"], 2);
}
#[test]
fn workflow_host_new_process_reads_and_refuses_crashed_active_owner() {
    use std::os::windows::process::CommandExt;
    let dir = temp();
    for mode in ["create", "read", "abandon-boundary", "abandon"] {
        let output = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "workflow::tests::workflow_host_process_probe",
                "--ignored",
                "--nocapture",
            ])
            .env("BLOCKY_WORKFLOW_TEST_ROOT", dir.path())
            .env("BLOCKY_WORKFLOW_TEST_MODE", mode)
            .creation_flags(0x08000000)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stdout)
        );
    }
    let store = Store::new(dir.path().to_owned()).unwrap();
    assert_eq!(
        store.read("task-one").unwrap()["state"],
        json!({"restored":true})
    );
    assert_eq!(
        store.acquire("task-one", &definition(), 4).err().unwrap(),
        "BLK-WORKFLOW-UNCERTAIN"
    );
}
#[test]
#[ignore = "Child-process fixture invoked only by the process recovery test"]
fn workflow_host_process_probe() {
    let root = std::env::var_os("BLOCKY_WORKFLOW_TEST_ROOT").unwrap();
    let store = Store::new(root.into()).unwrap();
    match std::env::var("BLOCKY_WORKFLOW_TEST_MODE").unwrap().as_str() {
        "create" => {
            store
                .create("task-one", &definition(), json!({"restored":true}))
                .unwrap();
            let mut lease = store.acquire("task-one", &definition(), 1).unwrap();
            lease.commit(&json!({"kind":"pause","revision":1})).unwrap();
            lease.release().unwrap();
        }
        "read" => {
            assert_eq!(
                store.read("task-one").unwrap()["state"],
                json!({"restored":true})
            );
            let mut lease = store.acquire("task-one", &definition(), 2).unwrap();
            lease
                .commit(&json!({"kind":"resume","revision":2}))
                .unwrap();
            lease.release().unwrap();
        }
        "abandon-boundary" => {
            let _lease = store.acquire("task-one", &definition(), 3).unwrap();
        }
        "abandon" => {
            let mut lease = store.acquire("task-one", &definition(), 3).unwrap();
            lease.commit(&json!({"kind":"begin","revision":3})).unwrap();
        }
        mode @ ("orphan-partial" | "orphan-encrypted") => {
            let mut lease = store.acquire("task-one", &definition(), 1).unwrap();
            lease.commit(&json!({"kind":"begin","revision":1})).unwrap();
            let root =
                std::path::PathBuf::from(std::env::var_os("BLOCKY_WORKFLOW_TEST_ROOT").unwrap());
            let identity = crate::process_identity::Identity::current().unwrap();
            let name = format!(
                ".workflow-{}-{}-{}-test00.tmp",
                identity.process_id,
                identity.created,
                uuid::Uuid::new_v4()
            );
            let bytes = if mode == "orphan-partial" {
                b"BLKWF1partial".to_vec()
            } else {
                std::fs::read(root.join("task-task-one.bin")).unwrap()
            };
            std::fs::write(root.join(name), bytes).unwrap();
            // Exit without Drop, as in a process interruption between stage write and rename.
            std::process::exit(0);
        }
        _ => panic!("unexpected fixture mode"),
    }
}

#[test]
fn workflow_host_recovers_dead_owner_staging_but_retains_unknown_intent() {
    use std::os::windows::process::CommandExt;
    for mode in ["orphan-partial", "orphan-encrypted"] {
        let dir = temp();
        let store = Store::new(dir.path().to_owned()).unwrap();
        store
            .create("task-one", &definition(), Value::Null)
            .unwrap();
        let output = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "workflow::tests::workflow_host_process_probe",
                "--ignored",
                "--nocapture",
            ])
            .env("BLOCKY_WORKFLOW_TEST_ROOT", dir.path())
            .env("BLOCKY_WORKFLOW_TEST_MODE", mode)
            .creation_flags(0x08000000)
            .output()
            .unwrap();
        assert!(output.status.success());
        store
            .create("task-two", &definition(), Value::Null)
            .expect("exited writer staging must not block all workflows");
        assert_eq!(store.read("task-one").unwrap()["status"], "executing");
        assert_eq!(
            store.acquire("task-one", &definition(), 2).err().unwrap(),
            "BLK-WORKFLOW-UNCERTAIN"
        );
        assert!(!std::fs::read_dir(dir.path()).unwrap().any(|e| {
            e.unwrap()
                .file_name()
                .to_string_lossy()
                .starts_with(".workflow-")
        }));
    }
}
#[test]
fn workflow_host_staging_retains_live_owner_and_unknown_files() {
    let dir = temp();
    let store = Store::new(dir.path().to_owned()).unwrap();
    store
        .create("task-one", &definition(), Value::Null)
        .unwrap();
    let staged = super::staging::create(dir.path()).unwrap();
    assert_eq!(store.read("task-one").unwrap_err(), "BLK-WORKFLOW-OWNER");
    assert!(staged.path().exists());
    drop(staged);
    assert!(store.read("task-one").is_ok());
    let unknown = dir.path().join(".workflow-unrecognized");
    std::fs::write(&unknown, b"private-test-bytes").unwrap();
    assert_eq!(store.read("task-one").unwrap_err(), "BLK-WORKFLOW-STORE");
    assert_eq!(std::fs::read(unknown).unwrap(), b"private-test-bytes");
}
#[test]
fn workflow_host_limits_never_evict_an_existing_checkpoint() {
    let dir = temp();
    let store = Store::new(dir.path().to_owned()).unwrap();
    for i in 0..128 {
        store
            .create(&format!("task-{i}"), &definition(), json!({"number":i}))
            .unwrap();
    }
    assert_eq!(
        store
            .create("task-overflow", &definition(), Value::Null)
            .unwrap_err(),
        "BLK-WORKFLOW-LIMIT"
    );
    assert_eq!(store.read("task-0").unwrap()["state"]["number"], 0);
    assert_eq!(store.read("task-127").unwrap()["state"]["number"], 127);
    let mut lease = store.acquire("task-0", &definition(), 1).unwrap();
    lease.commit(&json!({"kind":"pause","revision":1})).unwrap();
    lease.release().unwrap();
    assert_eq!(store.read("task-0").unwrap()["status"], "paused");
}
#[test]
fn workflow_host_rejects_corrupt_lock_and_reparse_root() {
    let dir = temp();
    let root = dir.path().join("root");
    let store = Store::new(root.clone()).unwrap();
    store
        .create("task-one", &definition(), Value::Null)
        .unwrap();
    std::fs::write(root.join("workflow.lock"), b"not-a-lock").unwrap();
    assert!(store.read("task-one").is_err());
    assert!(Store::new(dir.path().join("root/../escape")).is_err());
    // A Windows junction requires no symlink privilege. It only points at this test's own directory.
    let junction = dir.path().join("junction");
    use std::os::windows::process::CommandExt;
    let output = std::process::Command::new("cmd.exe")
        .args(["/d", "/c", "mklink", "/J"])
        .arg(&junction)
        .arg(&root)
        .creation_flags(0x08000000)
        .output()
        .unwrap();
    assert!(output.status.success(), "junction fixture creation failed");
    assert!(Store::new(junction.clone()).is_err());
    std::fs::remove_dir(junction).unwrap();
}
#[test]
fn workflow_host_failed_atomic_replace_leaves_previous_record_and_no_temp_file() {
    use std::os::windows::fs::OpenOptionsExt;
    let dir = temp();
    let store = Store::new(dir.path().to_owned()).unwrap();
    store
        .create("task-one", &definition(), Value::Null)
        .unwrap();
    let mut lease = store.acquire("task-one", &definition(), 1).unwrap();
    let reader = std::fs::File::options()
        .read(true)
        .share_mode(1)
        .open(dir.path().join("task-task-one.bin"))
        .unwrap();
    assert_eq!(
        lease
            .commit(&json!({"kind":"begin","revision":1}))
            .unwrap_err(),
        "BLK-WORKFLOW-STORE"
    );
    drop(reader);
    assert_eq!(store.read("task-one").unwrap()["status"], "ready");
    assert!(!std::fs::read_dir(dir.path()).unwrap().any(|e| {
        e.unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with(".workflow-")
    }));
    lease.release().unwrap();
}
