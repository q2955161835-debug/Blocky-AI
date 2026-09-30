use super::*;
use std::sync::atomic::AtomicBool;
pub(super) fn root() -> tempfile::TempDir {
    let root = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../try/agent-capability-upgrade/local-model-tests");
    std::fs::create_dir_all(&root).unwrap();
    tempfile::tempdir_in(root).unwrap()
}
#[test]
fn interrupted_install_is_visible_and_cleanup_checks_ownership_before_deleting() {
    let root = root();
    let parent = store::path(root.path(), MODEL_ID)
        .unwrap()
        .parent()
        .unwrap()
        .to_owned();
    let stage = parent.join(".install-owned");
    std::fs::create_dir(&stage).unwrap();
    let locked = artifacts::lock().unwrap();
    let backend = artifacts::backend(&locked, "cpu").unwrap();
    std::fs::write(
        stage.join("manifest.json"),
        store::manifest_value(&locked, &backend).to_string(),
    )
    .unwrap();
    std::fs::write(stage.join("runtime.zip"), b"partial download").unwrap();
    assert_eq!(
        status(root.path(), MODEL_ID).unwrap()["incompleteInstalls"],
        1
    );
    std::fs::write(stage.join("foreign.txt"), b"user content").unwrap();
    assert_eq!(
        cleanup(root.path(), MODEL_ID).unwrap_err(),
        "BLK-LOCAL-MODEL-OWNERSHIP"
    );
    assert!(stage.join("runtime.zip").exists());
    std::fs::remove_file(stage.join("foreign.txt")).unwrap();
    let guard = store::guard(root.path()).unwrap();
    assert_eq!(
        cleanup(root.path(), MODEL_ID).unwrap_err(),
        "BLK-LOCAL-MODEL-BUSY"
    );
    drop(guard);
    assert_eq!(
        cleanup(root.path(), MODEL_ID).unwrap()["cleanedInstalls"],
        1
    );
    assert!(!stage.exists());
    assert_eq!(
        status(root.path(), MODEL_ID).unwrap()["incompleteInstalls"],
        0
    );
}
#[test]
fn missing_or_unknown_models_are_reported_without_selecting_another_installation() {
    let root = root();
    let state = status(root.path(), MODEL_ID).unwrap();
    assert_eq!(state["installed"], false);
    assert_eq!(state["modelId"], MODEL_ID);
    for id in ["../outside", "other", "qwen3"] {
        assert!(status(root.path(), id).is_err());
        assert!(remove(root.path(), id).is_err());
    }
}
#[test]
fn cancelled_or_corrupt_import_never_publishes_a_model() {
    let root = root();
    let inputs = root.path().join("inputs");
    std::fs::create_dir(&inputs).unwrap();
    let source = InstallSource {
        model_file: inputs.join("model.gguf"),
        runtime_file: inputs.join("runtime.zip"),
    };
    std::fs::write(&source.model_file, b"corrupt").unwrap();
    std::fs::write(&source.runtime_file, b"corrupt").unwrap();
    assert!(
        install(
            root.path(),
            MODEL_ID,
            "cpu",
            Some(&source),
            &AtomicBool::new(true)
        )
        .is_err()
    );
    assert_eq!(
        install(
            root.path(),
            MODEL_ID,
            "cpu",
            Some(&source),
            &AtomicBool::new(false)
        )
        .unwrap_err(),
        "BLK-LOCAL-MODEL-HASH"
    );
    assert_eq!(status(root.path(), MODEL_ID).unwrap()["installed"], false);
    assert!(source.model_file.is_file());
}
#[test]
fn deletion_requires_an_owned_verified_manifest_and_refuses_foreign_files() {
    let root = root();
    let directory = root.path().join("managed-models").join(MODEL_ID);
    std::fs::create_dir_all(&directory).unwrap();
    std::fs::write(directory.join("user-document.txt"), "keep this").unwrap();
    assert!(remove(root.path(), MODEL_ID).is_err());
    assert!(directory.join("user-document.txt").is_file());
}
#[test]
fn interrupted_owned_removal_can_be_retried_and_busy_installs_cannot_be_removed() {
    let root = root();
    let directory = store::path(root.path(), MODEL_ID).unwrap();
    std::fs::create_dir_all(directory.join("runtime")).unwrap();
    let locked = artifacts::lock().unwrap();
    let backend = artifacts::backend(&locked, "cpu").unwrap();
    std::fs::write(
        directory.join("manifest.json"),
        store::manifest_value(&locked, &backend).to_string(),
    )
    .unwrap();
    std::fs::write(
        directory.join("runtime").join(&backend.files[0].name),
        b"remaining owned file",
    )
    .unwrap();
    let guard = store::guard(root.path()).unwrap();
    assert_eq!(
        remove(root.path(), MODEL_ID).unwrap_err(),
        "BLK-LOCAL-MODEL-BUSY"
    );
    drop(guard);
    assert_eq!(remove(root.path(), MODEL_ID).unwrap()["removed"], true);
    assert!(!directory.exists());
}
