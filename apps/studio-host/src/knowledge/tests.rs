use super::*;
use serde_json::json;
use std::fs;

fn setup() -> (tempfile::TempDir, KnowledgeStore, std::path::PathBuf) {
    let dir =
        tempfile::tempdir_in(std::env::current_dir().unwrap().join("../../try/stage3")).unwrap();
    let files = dir.path().join("input");
    fs::create_dir(&files).unwrap();
    fs::write(
        files.join("lesson.md"),
        "# Lesson\nA real lesson about light.\n",
    )
    .unwrap();
    (
        dir,
        KnowledgeStore::new(files.parent().unwrap().join("store")),
        files,
    )
}
#[test]
fn citation_read_rejects_stale_version_and_revoked_grant() {
    let (_dir, store, files) = setup();
    let s = store
        .add("p", "c", "directory", files.to_str().unwrap(), None)
        .unwrap();
    let id = s["sourceId"].as_str().unwrap();
    let page = store.read_source("p", "c", id, None, None).unwrap();
    let doc = &page["documents"][0];
    let did = doc["documentId"].as_str().unwrap();
    let revision = doc["revision"].as_str().unwrap();
    assert_eq!(
        store.read_document("p", "c", id, did, revision).unwrap(),
        *doc
    );
    fs::write(files.join("lesson.md"), "Updated lesson").unwrap();
    store.read_source("p", "c", id, None, None).unwrap();
    assert_eq!(
        store
            .read_document("p", "c", id, did, revision)
            .unwrap_err(),
        STALE
    );
    store.acl("p", "c", id, vec![]).unwrap();
    assert_eq!(
        store
            .read_document("p", "c", id, did, revision)
            .unwrap_err(),
        DENIED
    );
}
#[test]
fn real_source_paging_restart_and_cross_project_denial() {
    let (_dir, store, files) = setup();
    fs::write(files.join(".env"), "API_KEY=private").unwrap();
    fs::write(files.join("unsupported.bin"), [0, 1, 2]).unwrap();
    let s = store
        .add("p.one", "c.one", "directory", files.to_str().unwrap(), None)
        .unwrap();
    let id = s["sourceId"].as_str().unwrap();
    let page = store.read_source("p.one", "c.one", id, None, None).unwrap();
    assert_eq!(page["documents"].as_array().unwrap().len(), 1);
    assert!(
        page["documents"][0]["text"]
            .as_str()
            .unwrap()
            .contains("real lesson")
    );
    assert_eq!(page["documents"][0]["locator"]["path"], "lesson.md");
    assert_eq!(page["excluded"].as_array().unwrap().len(), 2);
    assert!(
        !serde_json::to_string(&s)
            .unwrap()
            .contains(files.to_str().unwrap())
    );
    assert!(store.read_source("other", "c.one", id, None, None).is_err());
    let reopened = KnowledgeStore::new(store.root.clone());
    assert_eq!(
        reopened.sources("p.one", "c.one").unwrap()["sources"][0]["sourceId"],
        id
    );
}
#[test]
fn atomic_index_cas_acl_invalidation_and_restart() {
    let (_dir, store, files) = setup();
    let s = store
        .add("p", "c", "directory", files.to_str().unwrap(), None)
        .unwrap();
    let id = s["sourceId"].as_str().unwrap();
    let before = store.load_index("p", "c").unwrap();
    let generation = before["generation"].as_u64().unwrap();
    let current = before["revision"].as_u64().unwrap();
    let saved = store.save_index("p", "c", current, generation, json!({"schemaVersion":"blocky.knowledge-store/v1","index":{"generation":generation,"sources":{id:"v1"},"documents":[],"chunks":[]},"pending":null})).unwrap();
    assert_eq!(saved["revision"], current + 1);
    assert!(
        store
            .save_index("p", "c", 0, generation, json!({}))
            .is_err()
    );
    store.acl("p", "c", id, vec![]).unwrap();
    assert!(store.load_index("p", "c").unwrap()["value"].is_null());
    assert!(store.read_source("p", "c", id, None, None).is_err());
    assert!(
        store
            .save_index("p", "c", 2, generation, json!({"index":"stale evidence"}))
            .is_err()
    );
    assert_eq!(
        store.sources("p", "c").unwrap()["sources"][0]["readable"],
        false
    );
    assert!(
        store
            .add("../escape", "c", "directory", files.to_str().unwrap(), None)
            .is_err()
    );
    assert!(
        store
            .acl("p", "c", id, vec!["impersonated-user".into()])
            .is_err()
    );
}

#[test]
fn failed_document_extraction_preserves_the_last_source_snapshot() {
    let (_dir, store, files) = setup();
    let source = store.add("p", "c", "directory", files.to_str().unwrap(), None).unwrap();
    let id = source["sourceId"].as_str().unwrap();
    let before = store.read_source("p", "c", id, None, None).unwrap();
    fs::write(files.join("broken.pdf"), b"invalid PDF").unwrap();
    assert!(store.read_source("p", "c", id, None, None).is_err());
    let retained = store.read_source("p", "c", id, Some(0), before["revision"].as_str()).unwrap();
    assert_eq!(retained["documents"], before["documents"]);
    assert_eq!(retained["revision"], before["revision"]);
}
#[test]
fn changed_and_deleted_files_change_snapshot_and_old_cursor_is_rejected() {
    let (_dir, store, files) = setup();
    let s = store
        .add("p", "c", "directory", files.to_str().unwrap(), None)
        .unwrap();
    let id = s["sourceId"].as_str().unwrap();
    let first = store.read_source("p", "c", id, None, None).unwrap();
    fs::remove_file(files.join("lesson.md")).unwrap();
    let second = store.read_source("p", "c", id, None, None).unwrap();
    assert_ne!(first["revision"], second["revision"]);
    assert_eq!(second["documents"], json!([]));
    assert!(
        store
            .read_source("p", "c", id, Some(1), first["revision"].as_str())
            .is_err()
    );
    store.remove("p", "c", id).unwrap();
    assert!(store.read_source("p", "c", id, None, None).is_err());
}
#[test]
fn network_targets_reject_private_reserved_and_credentials() {
    for url in [
        "http://127.0.0.1/a",
        "http://10.1.2.3/a",
        "http://[::1]/",
        "http://[::ffff:127.0.0.1]/",
        "https://user:pass@example.com/",
        "file:///tmp/a",
        "http://169.254.169.254/",
    ] {
        assert!(network::validate_url(url).is_err(), "{url}");
    }
    assert!(network::validate_url("https://example.com/docs").is_ok());
}

#[test]
fn pages_are_bounded_and_persisted_objects_are_integrity_checked() {
    let (_dir, store, files) = setup();
    for n in 0..130 {
        fs::write(
            files.join(format!("file-{n:03}.md")),
            format!("Document {n}\nUnique source evidence"),
        )
        .unwrap();
    }
    let source = store
        .add("p", "c", "directory", files.to_str().unwrap(), None)
        .unwrap();
    let id = source["sourceId"].as_str().unwrap();
    let first = store.read_source("p", "c", id, None, None).unwrap();
    assert_eq!(first["documents"].as_array().unwrap().len(), 128);
    let second = store
        .read_source("p", "c", id, Some(128), first["revision"].as_str())
        .unwrap();
    assert_eq!(second["documents"].as_array().unwrap().len(), 3);
    assert!(second["nextCursor"].is_null());
    assert_eq!(first["revision"], second["revision"]);
}
#[test]
fn repository_reads_commit_not_dirty_worktree_without_running_hooks() {
    let (_dir, store, files) = setup();
    let git = |args: &[&str]| {
        let result = std::process::Command::new("git")
            .arg("-C")
            .arg(&files)
            .args(args)
            .output()
            .unwrap();
        assert!(result.status.success());
        result.stdout
    };
    git(&["init", "--quiet"]);
    git(&["add", "lesson.md"]);
    git(&[
        "-c",
        "user.name=Knowledge Test",
        "-c",
        "user.email=test@example.invalid",
        "commit",
        "--quiet",
        "-m",
        "baseline",
    ]);
    fs::write(files.join("lesson.md"), "dirty worktree must not be read").unwrap();
    fs::write(
        files.join(".git/hooks/post-checkout"),
        "#!/bin/sh\ntouch hook-executed\n",
    )
    .unwrap();
    let source = store
        .add("p", "c", "repository", files.to_str().unwrap(), None)
        .unwrap();
    assert_eq!(source["metadata"]["dirty"], "true");
    let page = store
        .read_source("p", "c", source["sourceId"].as_str().unwrap(), None, None)
        .unwrap();
    assert!(
        page["documents"][0]["text"]
            .as_str()
            .unwrap()
            .contains("real lesson")
    );
    assert_eq!(
        page["documents"][0]["locator"]["commit"],
        source["metadata"]["commit"]
    );
    assert_eq!(
        fs::read_to_string(files.join("lesson.md")).unwrap(),
        "dirty worktree must not be read"
    );
    assert!(!files.join("hook-executed").exists());
}
#[test]
fn cancellation_epoch_is_cross_instance_and_unknown_protocol_fields_fail() {
    let (_dir, store, _) = setup();
    let scope = store.root.join(digest(b"p")).join(digest(b"c"));
    store.sources("p", "c").unwrap();
    let _guard = cancel::Cancellation::begin(&scope);
    assert!(cancel::check().is_ok());
    KnowledgeStore::new(store.root.clone())
        .cancel("p", "c")
        .unwrap();
    assert_eq!(cancel::check().unwrap_err(), "BLK-KNOW-CANCELLED");
    assert!(dispatch(&store,&json!({"operation":"knowledge-sources","projectId":"p","collectionId":"c","path":"forbidden"})).is_err());
}
#[cfg(windows)]
#[test]
fn directory_junction_cannot_escape_authorized_root() {
    let (dir, store, files) = setup();
    let outside = dir.path().join("outside");
    fs::create_dir(&outside).unwrap();
    fs::write(outside.join("private.md"), "must not cross junction").unwrap();
    let junction = files.join("linked");
    let script = format!(
        "New-Item -ItemType Junction -Path '{}' -Target '{}' | Out-Null",
        junction.display(),
        outside.display()
    );
    let result = std::process::Command::new("pwsh")
        .args(["-NoProfile", "-Command", &script])
        .output()
        .unwrap();
    assert!(result.status.success());
    let s = store
        .add("p", "c", "directory", files.to_str().unwrap(), None)
        .unwrap();
    let page = store
        .read_source("p", "c", s["sourceId"].as_str().unwrap(), None, None)
        .unwrap();
    assert_eq!(page["documents"].as_array().unwrap().len(), 1);
    assert!(
        page["excluded"]
            .as_array()
            .unwrap()
            .iter()
            .any(|e| e["reason"] == "link-denied")
    );
    assert!(
        store
            .add("p", "c", "directory", junction.to_str().unwrap(), None)
            .is_err()
    );
}

#[test]
fn source_add_rebinds_epoch_without_discarding_unchanged_index() {
    let (_dir, store, files) = setup();
    let first = store
        .add(
            "p",
            "c",
            "file",
            files.join("lesson.md").to_str().unwrap(),
            None,
        )
        .unwrap();
    let id = first["sourceId"].as_str().unwrap();
    let state = store.load_index("p", "c").unwrap();
    let generation = state["generation"].as_u64().unwrap();
    let value = json!({"schemaVersion":"blocky.knowledge-store/v1","index":{"generation":generation,"sources":{id:"v1"},"documents":[],"chunks":[]},"pending":null});
    store
        .save_index(
            "p",
            "c",
            state["revision"].as_u64().unwrap(),
            generation,
            value,
        )
        .unwrap();
    fs::write(files.join("second.md"), "Second source").unwrap();
    store
        .add(
            "p",
            "c",
            "file",
            files.join("second.md").to_str().unwrap(),
            None,
        )
        .unwrap();
    let after = store.load_index("p", "c").unwrap();
    assert_eq!(after["value"]["index"]["sources"][id], "v1");
    assert_eq!(after["value"]["index"]["generation"], after["generation"]);
    let mut forged = after["value"].clone();
    forged["index"]["sources"]["src-not-in-this-project"] = json!("forged");
    assert_eq!(
        store
            .save_index(
                "p",
                "c",
                after["revision"].as_u64().unwrap(),
                after["generation"].as_u64().unwrap(),
                forged
            )
            .unwrap_err(),
        DENIED
    );
}
#[test]
fn changed_resource_blob_is_rejected_instead_of_reused() {
    let (_dir, store, files) = setup();
    let source = store
        .add("p", "c", "directory", files.to_str().unwrap(), None)
        .unwrap();
    let id = source["sourceId"].as_str().unwrap();
    let first = store.read_source("p", "c", id, None, None).unwrap();
    let revision = first["documents"][0]["revision"].as_str().unwrap();
    let target = store
        .root
        .join(digest(b"p"))
        .join(digest(b"c"))
        .join("objects")
        .join(format!("{revision}.txt"));
    fs::write(target, "tampered").unwrap();
    assert_eq!(
        store
            .read_source("p", "c", id, Some(0), first["revision"].as_str())
            .unwrap_err(),
        "BLK-KNOW-CORRUPT"
    );
}

#[test]
fn repository_dirty_probe_never_executes_clean_filters() {
    let (_dir, _, files) = setup();
    let git = |args: &[&str]| {
        let result = std::process::Command::new("git")
            .arg("-C")
            .arg(&files)
            .args(args)
            .output()
            .unwrap();
        assert!(result.status.success(), "fixture git failed");
        result.stdout
    };
    fs::write(files.join("lesson.md"), "trusted committed lesson\n").unwrap();
    git(&["init", "--quiet"]);
    git(&["add", "lesson.md"]);
    git(&[
        "-c",
        "user.name=Knowledge Test",
        "-c",
        "user.email=test@example.invalid",
        "commit",
        "--quiet",
        "-m",
        "baseline",
    ]);
    fs::write(files.join(".gitattributes"), "lesson.md filter=probe\n").unwrap();
    git(&[
        "config",
        "filter.probe.clean",
        "echo executed > filter-executed; cat",
    ]);
    fs::write(files.join("lesson.md"), "changed committed lesson\n").unwrap();
    let metadata = repository::describe(&files, None).unwrap();
    assert!(
        !files.join("filter-executed").exists(),
        "read-only dirty probe executed a repository clean filter"
    );
    assert_eq!(metadata["dirty"], "true");
}
#[test]
fn missing_promisor_blob_is_rejected_without_implicit_fetch() {
    let (dir, _, files) = setup();
    let git = |args: &[&str]| {
        let result = std::process::Command::new("git")
            .arg("-C")
            .arg(&files)
            .args(args)
            .output()
            .unwrap();
        assert!(result.status.success(), "fixture git failed");
        String::from_utf8(result.stdout).unwrap().trim().to_owned()
    };
    git(&["init", "--quiet"]);
    git(&["add", "lesson.md"]);
    git(&[
        "-c",
        "user.name=Knowledge Test",
        "-c",
        "user.email=test@example.invalid",
        "commit",
        "--quiet",
        "-m",
        "baseline",
    ]);
    let remote = dir.path().join("remote");
    git(&[
        "clone",
        "--quiet",
        "--no-local",
        files.to_str().unwrap(),
        remote.to_str().unwrap(),
    ]);
    git(&["remote", "add", "origin", remote.to_str().unwrap()]);
    git(&["config", "remote.origin.promisor", "true"]);
    git(&["config", "remote.origin.partialclonefilter", "blob:none"]);
    let oid = git(&["rev-parse", "HEAD:lesson.md"]);
    let blob = files.join(".git/objects").join(&oid[..2]).join(&oid[2..]);
    fs::remove_file(&blob).unwrap();
    assert!(
        repository::describe(&files, None).is_err(),
        "missing blob must fail rather than launch a promisor fetch"
    );
    assert!(!blob.exists());
}

#[test]
fn repository_raw_dirty_policy_reports_comparison_scope_and_unchecked_files() {
    let (_dir, _, files) = setup();
    let git = |args: &[&str]| {
        let result = std::process::Command::new("git")
            .arg("-C")
            .arg(&files)
            .args(args)
            .output()
            .unwrap();
        assert!(result.status.success(), "fixture git failed");
    };
    fs::write(files.join("lesson.md"), "one\ntwo\n").unwrap();
    git(&["init", "--quiet"]);
    git(&["-c", "core.autocrlf=false", "add", "lesson.md"]);
    git(&[
        "-c",
        "user.name=Knowledge Test",
        "-c",
        "user.email=test@example.invalid",
        "commit",
        "--quiet",
        "-m",
        "baseline",
    ]);
    let clean = repository::describe(&files, None).unwrap();
    assert_eq!(clean["dirty"], "false");
    assert_eq!(clean["dirtyChecked"], "1");
    assert_eq!(clean["dirtyPolicy"], "locked-commit-tracked-raw-bytes-v1");
    fs::write(
        files.join("untracked.md"),
        "untracked is outside declared scope",
    )
    .unwrap();
    assert_eq!(
        repository::describe(&files, None).unwrap()["dirty"],
        "false"
    );
    fs::write(files.join("lesson.md"), "one\r\ntwo\r\n").unwrap();
    assert_eq!(
        repository::describe(&files, None).unwrap()["dirtyChanged"],
        "1"
    );
    fs::remove_file(files.join("lesson.md")).unwrap();
    assert_eq!(
        repository::describe(&files, None).unwrap()["dirtyChanged"],
        "1"
    );
    fs::write(files.join("lesson.md"), "one\ntwo\n").unwrap();
    fs::write(files.join("large.bin"), vec![0u8; MAX_DOCUMENT + 1]).unwrap();
    git(&["-c", "core.autocrlf=false", "add", "large.bin"]);
    git(&[
        "-c",
        "user.name=Knowledge Test",
        "-c",
        "user.email=test@example.invalid",
        "commit",
        "--quiet",
        "-m",
        "large file",
    ]);
    let partial = repository::describe(&files, None).unwrap();
    assert_eq!(partial["dirty"], "unknown");
    assert_eq!(partial["dirtyChecked"], "1");
    assert_eq!(partial["dirtyUnchecked"], "1");
}
