use super::*;
use std::path::PathBuf;
fn profile() -> tempfile::TempDir {
    let base = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../try/agent-capability-upgrade/cleanup-tests");
    std::fs::create_dir_all(&base).unwrap();
    tempfile::tempdir_in(base).unwrap()
}
fn interrupted(profile: &Path, name: &str) -> PathBuf {
    let root = profile.join("tool-sessions").join(name);
    std::fs::create_dir_all(root.join("bundle/nested")).unwrap();
    std::fs::create_dir(root.join("work")).unwrap();
    let lock = record_pending(
        &root,
        vec![
            "bundle/nested/server.exe".into(),
            "bundle/not-copied.txt".into(),
        ],
    )
    .unwrap();
    std::fs::write(root.join("bundle/nested/server.exe"), b"partial").unwrap();
    std::fs::write(root.join("work/result.txt"), b"public scratch").unwrap();
    drop(lock);
    root
}
#[test]
fn partial_copy_is_counted_and_cleaned_without_touching_a_sibling() {
    let profile = profile();
    let root = interrupted(profile.path(), "mcp-interrupted");
    let sibling = profile.path().join("owned-by-user.txt");
    std::fs::write(&sibling, "keep").unwrap();
    let status = cleanup_status(profile.path()).unwrap();
    assert_eq!(status["incompleteSessions"], 1);
    assert!(status["incompleteBytes"].as_u64().unwrap() > 20);
    let result = cleanup(profile.path()).unwrap();
    assert_eq!(result["removedSessions"], 1);
    assert!(!root.exists());
    assert_eq!(std::fs::read_to_string(sibling).unwrap(), "keep");
    assert_eq!(cleanup(profile.path()).unwrap()["removedSessions"], 0);
}
#[test]
fn active_session_is_retained_and_foreign_files_block_the_entire_cleanup() {
    let profile = profile();
    let first = interrupted(profile.path(), "mcp-first");
    let second = interrupted(profile.path(), "mcp-second");
    let active = OpenOptions::new()
        .read(true)
        .write(true)
        .open(first.join("sandbox.lock"))
        .unwrap();
    active.try_lock().unwrap();
    assert_eq!(cleanup_status(profile.path()).unwrap()["activeSessions"], 1);
    assert_eq!(cleanup(profile.path()).unwrap_err(), "BLK-TOOL-BUSY");
    assert!(second.exists());
    drop(active);
    std::fs::write(second.join("user-note.txt"), "keep").unwrap();
    assert_eq!(cleanup(profile.path()).unwrap_err(), OWNERSHIP);
    assert!(first.join("bundle/nested/server.exe").exists());
    assert_eq!(
        std::fs::read_to_string(second.join("user-note.txt")).unwrap(),
        "keep"
    );
}
#[test]
fn a_link_in_scratch_cannot_escape_owned_cleanup() {
    let profile = profile();
    let root = interrupted(profile.path(), "mcp-link");
    let outside = profile.path().join("outside");
    std::fs::create_dir(&outside).unwrap();
    std::fs::write(outside.join("keep.txt"), "keep").unwrap();
    std::os::windows::fs::symlink_dir(&outside, root.join("work/link")).unwrap();
    assert_eq!(cleanup(profile.path()).unwrap_err(), OWNERSHIP);
    assert_eq!(
        std::fs::read_to_string(outside.join("keep.txt")).unwrap(),
        "keep"
    );
    std::fs::remove_dir(root.join("work/link")).unwrap();
}
