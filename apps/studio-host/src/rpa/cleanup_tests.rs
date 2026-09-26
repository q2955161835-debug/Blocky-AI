use super::*;
use std::os::windows::process::CommandExt;

#[test]
fn cleanup_fixture() {
    let Some(root) = std::env::var_os("BLOCKY_RPA_CLEANUP_FIXTURE") else { return; };
    let host = RpaHost::with_journal(root.into());
    let grant = host.insert(tests::prepared()).unwrap();
    let token = grant["sessionId"].as_str().unwrap();
    host.step_with(token, "first", None, |_, _, _| Ok(json!({"invoked":true}))).unwrap();
    host.step_with(token, "second", None, |_, _, _| Ok(json!({"found":true}))).unwrap();
    let id = host.status(token).unwrap()["checkpointId"].as_str().unwrap().to_owned();
    let store = host.journal.as_ref().unwrap();
    assert_eq!(store.inspect(&id).unwrap()["settled"], false);
    host.stop(token).unwrap();
    let saved = store.inspect(&id).unwrap();
    assert_eq!(saved["settled"], true);
    assert_eq!(saved["deletable"], false); // Owner is still alive.
    assert_eq!(saved["deleteBlockedCode"], "BLK-RPA-RECOVERY-001");
}
fn fixture(root: &std::path::Path) -> journal::Snapshot {
    let status = std::process::Command::new(std::env::current_exe().unwrap())
        .args(["--exact", "rpa::cleanup_tests::cleanup_fixture", "--nocapture"])
        .env("BLOCKY_RPA_CLEANUP_FIXTURE", root).creation_flags(0x08000000)
        .stdin(std::process::Stdio::null()).stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null()).status().unwrap();
    assert!(status.success());
    let store = journal::Store::new(root.to_owned());
    let item = store.summaries().unwrap().remove(0);
    store.read_bound(item["checkpointId"].as_str().unwrap(), &tests::prepared().plan).unwrap()
}
fn request(snapshot: &journal::Snapshot) -> cleanup::Request {
    cleanup::Request { schema_version:"blocky.rpa-checkpoint-delete/v1".into(), checkpoint_id:snapshot.checkpoint_id.clone(), revision:snapshot.revision }
}

#[test]
fn cleanup_deletes_only_exact_settled_revision_after_owner_exit_and_releases_capacity() {
    let root = tests::journal_directory();
    let saved = fixture(root.path());
    let store = journal::Store::new(root.path().to_owned());
    assert_eq!(store.inspect(&saved.checkpoint_id).unwrap()["deletable"], true);
    let mut stale = request(&saved); stale.revision -= 1;
    assert_eq!(store.delete(&stale).unwrap_err(), "BLK-RPA-JOURNAL-003");
    for i in 0..99 {
        let mut copy = saved.clone(); copy.checkpoint_id = format!("checkpoint-copy-{i}");
        store.save(copy, 0).unwrap();
    }
    let mut extra = saved.clone(); extra.checkpoint_id = "checkpoint-extra".into();
    assert_eq!(store.save(extra.clone(),0).unwrap_err(), "BLK-RPA-JOURNAL-004");
    let result = journal::dispatch(root.path().to_owned(), json!({"schemaVersion":"blocky.project-io/v1alpha1","operation":"rpa-checkpoint-delete",
        "deletion":{"schemaVersion":"blocky.rpa-checkpoint-delete/v1","checkpointId":saved.checkpoint_id,"revision":saved.revision}})).unwrap();
    assert_eq!(result["deleted"], true);
    assert!(!root.path().join(format!("{}.bin",saved.checkpoint_id)).exists());
    assert!(store.inspect("checkpoint-copy-0").is_ok());
    assert!(store.delete(&request(&saved)).is_err());
    store.save(extra,0).unwrap();
    assert_eq!(store.summaries().unwrap().len(), 100);
}

#[test]
fn cleanup_preserves_legacy_uncertain_unsettled_and_recoverable_records() {
    let root = tests::journal_directory();
    let saved = fixture(root.path());
    let mut legacy = serde_json::to_value(&saved).unwrap();
    legacy.as_object_mut().unwrap().remove("settled");
    let old: journal::Snapshot = serde_json::from_value(legacy).unwrap();
    assert!(!old.settled);
    assert_eq!(cleanup::eligible(&old).unwrap_err(), "BLK-RPA-CLEANUP-001");
    for status in ["ready","running","paused","settlement-failed","persistence-failed"] {
        let mut item = saved.clone(); item.status = status.into(); item.settled = false;
        assert!(cleanup::eligible(&item).is_err());
    }
    let store = journal::Store::new(root.path().to_owned());
    let mut recoverable = saved.clone(); recoverable.status="stopped".into(); recoverable.next=1;
    recoverable.revision=store.save(recoverable.clone(),saved.revision).unwrap();
    assert_eq!(store.delete(&request(&recoverable)).unwrap_err(), "BLK-RPA-CLEANUP-002");
    let mut uncertain=recoverable.clone(); uncertain.next=0; uncertain.receipts[0].status="uncertain".into();
    uncertain.revision=store.save(uncertain.clone(),recoverable.revision).unwrap();
    assert_eq!(store.delete(&request(&uncertain)).unwrap_err(), "BLK-RPA-CLEANUP-001");
    assert!(store.inspect(&saved.checkpoint_id).is_ok());
    let mut traversal=request(&saved); traversal.checkpoint_id="checkpoint-../outside".into();
    assert_eq!(store.delete(&traversal).unwrap_err(), "BLK-RPA-JOURNAL-002");
}
