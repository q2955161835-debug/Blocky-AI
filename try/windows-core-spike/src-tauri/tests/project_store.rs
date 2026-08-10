use blocky_windows_core_spike_lib::project_store::{
    MAX_PROJECT_BYTES, ProjectStore, SaveProjectRequest,
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::fs;
use std::path::Path;
use tempfile::tempdir;

const EXACT_JSON: &str = concat!(
    "{\"schemaVersion\":\"blocky.spike-project/v1\",",
    "\"projectId\":\"demo-project\",\"workspace\":{},",
    "\"program\":{},\"interactionManifest\":{}}"
);

fn request(project_id: &str, json: String) -> SaveProjectRequest {
    SaveProjectRequest {
        project_id: project_id.to_owned(),
        json,
    }
}

fn valid_json(project_id: &str, value: Value) -> String {
    json!({
        "schemaVersion": "blocky.spike-project/v1",
        "projectId": project_id,
        "workspace": value,
        "program": {},
        "interactionManifest": {},
    })
    .to_string()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PathSensitivityVectors {
    sensitive_fragments: Vec<Vec<String>>,
    allowed: Vec<String>,
}

fn path_sensitivity_vectors() -> PathSensitivityVectors {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../tests/fixtures/path-sensitivity-vectors.json");
    serde_json::from_str(&fs::read_to_string(path).expect("shared path vectors are readable"))
        .expect("shared path vectors are valid JSON")
}

fn exact_size_json(project_id: &str, bytes: usize) -> String {
    let prefix = format!(
        "{{\"schemaVersion\":\"blocky.spike-project/v1\",\"projectId\":\"{project_id}\",\"workspace\":{{\"padding\":\""
    );
    let suffix = "\"},\"program\":{},\"interactionManifest\":{}}";
    assert!(prefix.len() + suffix.len() <= bytes);
    format!(
        "{prefix}{}{suffix}",
        "x".repeat(bytes - prefix.len() - suffix.len())
    )
}

#[cfg(unix)]
fn create_directory_symlink(original: &Path, link: &Path) -> std::io::Result<()> {
    std::os::unix::fs::symlink(original, link)
}

#[cfg(windows)]
fn create_directory_symlink(original: &Path, link: &Path) -> std::io::Result<()> {
    std::os::windows::fs::symlink_dir(original, link)
}

#[cfg(unix)]
fn create_file_symlink(original: &Path, link: &Path) -> std::io::Result<()> {
    std::os::unix::fs::symlink(original, link)
}

#[cfg(windows)]
fn create_file_symlink(original: &Path, link: &Path) -> std::io::Result<()> {
    std::os::windows::fs::symlink_file(original, link)
}

#[test]
fn project_store_round_trips_exact_bytes_and_lowercase_sha256() {
    let directory = tempdir().expect("temporary project directory");
    let store = ProjectStore::new(directory.path().to_path_buf());

    let saved = store
        .save(request("demo-project", EXACT_JSON.to_owned()))
        .expect("save succeeds");
    let loaded = store.load("demo-project").expect("load succeeds");

    assert_eq!(saved.project_id, "demo-project");
    assert_eq!(loaded.json, EXACT_JSON);
    assert_eq!(loaded.sha256, saved.sha256);
    assert_eq!(loaded.bytes, EXACT_JSON.len() as u64);
    assert_eq!(
        saved.sha256,
        "ebca7d4f3393bf6d66e993fb4c16af9d11c4495797d8750b5f51da6ee9c6be3f"
    );
    assert!(saved.sha256.bytes().all(|byte| !byte.is_ascii_uppercase()));
    assert_eq!(
        std::fs::read(directory.path().join("demo-project.json")).expect("exact target exists"),
        EXACT_JSON.as_bytes()
    );
}

#[test]
fn project_store_rejects_unsafe_project_ids_before_other_validation() {
    let directory = tempdir().expect("temporary project directory");
    let store = ProjectStore::new(directory.path().to_path_buf());
    let invalid_ids = [
        "",
        "Uppercase",
        "slash/name",
        "back\\name",
        "..",
        "trailing-",
        "two--hyphens",
    ];

    for project_id in invalid_ids {
        let error = store
            .save(request(project_id, "not-json".to_owned()))
            .expect_err("unsafe project ID is rejected");
        assert_eq!(error.code, "PROJECT_ID_INVALID", "ID: {project_id:?}");
    }

    let error = store
        .save(request(&"a".repeat(65), "not-json".to_owned()))
        .expect_err("overlong project ID is rejected");
    assert_eq!(error.code, "PROJECT_ID_INVALID");
}

#[test]
fn project_store_enforces_utf8_byte_limit_before_json_parsing() {
    let directory = tempdir().expect("temporary project directory");
    let store = ProjectStore::new(directory.path().to_path_buf());
    let oversized_invalid_json = "x".repeat(MAX_PROJECT_BYTES + 1);

    let error = store
        .save(request("demo-project", oversized_invalid_json))
        .expect_err("oversized project is rejected");

    assert_eq!(error.code, "PROJECT_TOO_LARGE");
}

#[test]
fn project_store_rejects_malformed_json() {
    let directory = tempdir().expect("temporary project directory");
    let store = ProjectStore::new(directory.path().to_path_buf());

    let error = store
        .save(request("demo-project", "{not-json".to_owned()))
        .expect_err("malformed JSON is rejected");

    assert_eq!(error.code, "PROJECT_JSON_INVALID");
}

#[test]
fn project_store_checks_schema_before_embedded_project_id() {
    let directory = tempdir().expect("temporary project directory");
    let store = ProjectStore::new(directory.path().to_path_buf());
    let json = json!({
        "schemaVersion": "blocky.spike-project/v2",
        "projectId": "another-project",
        "workspace": {},
    })
    .to_string();

    let error = store
        .save(request("demo-project", json))
        .expect_err("unsupported schema is rejected first");

    assert_eq!(error.code, "PROJECT_SCHEMA_UNSUPPORTED");
}

#[test]
fn project_store_checks_embedded_project_id_before_sensitive_values() {
    let directory = tempdir().expect("temporary project directory");
    let store = ProjectStore::new(directory.path().to_path_buf());
    let fragmented_token = ["sk", "-", &"x".repeat(24)].concat();
    let json = valid_json(
        "another-project",
        json!({ "nested": [{ "value": fragmented_token }] }),
    );

    let error = store
        .save(request("demo-project", json))
        .expect_err("project ID mismatch is rejected first");

    assert_eq!(error.code, "PROJECT_ID_MISMATCH");
}

#[test]
fn project_store_recursively_rejects_sensitive_string_values() {
    let fragmented_values = [
        ["sk", "-", &"x".repeat(24)].concat(),
        ["coo", "kie: session=fragmented-value"].concat(),
        ["-----BEGIN ", "PRIVATE KEY-----"].concat(),
        ["C:", "\\", "Users", "\\", "demo", "\\", "key.txt"].concat(),
        ["/", "var", "/", "tmp", "/", "key.txt"].concat(),
    ];

    for value in fragmented_values {
        let directory = tempdir().expect("temporary project directory");
        let store = ProjectStore::new(directory.path().to_path_buf());
        let json = valid_json(
            "demo-project",
            json!({ "level": [{ "nested": { "value": value } }] }),
        );
        let error = store
            .save(request("demo-project", json))
            .expect_err("sensitive string is rejected");

        assert_eq!(error.code, "PROJECT_SENSITIVE_VALUE");
        assert!(
            !error
                .message
                .contains(directory.path().to_string_lossy().as_ref())
        );
    }
}

#[test]
fn project_store_scans_string_values_but_not_property_names() {
    let directory = tempdir().expect("temporary project directory");
    let store = ProjectStore::new(directory.path().to_path_buf());
    let fragmented_path_key = ["C:", "\\", "Users", "\\", "demo", "\\", "key.txt"].concat();
    let json = valid_json("demo-project", json!({ fragmented_path_key: 7 }));

    store
        .save(request("demo-project", json))
        .expect("sensitive-looking property names are not values");
}

#[test]
fn project_store_reports_not_found_without_leaking_the_storage_path() {
    let directory = tempdir().expect("temporary project directory");
    let store = ProjectStore::new(directory.path().join("private-root"));

    let error = store
        .load("missing-project")
        .expect_err("missing project is rejected");

    assert_eq!(error.code, "PROJECT_NOT_FOUND");
    assert!(
        !error
            .message
            .contains(directory.path().to_string_lossy().as_ref())
    );
    assert!(!error.message.contains("missing-project.json"));
}

#[test]
fn project_store_applies_the_shared_path_sensitivity_vectors() {
    let vectors = path_sensitivity_vectors();
    for fragments in vectors.sensitive_fragments {
        let value = fragments.concat();
        let directory = tempdir().expect("temporary project directory");
        let store = ProjectStore::new(directory.path().to_path_buf());
        let error = store
            .save(request(
                "demo-project",
                valid_json("demo-project", json!({ "value": value })),
            ))
            .expect_err("sensitive path vector is rejected");
        assert_eq!(error.code, "PROJECT_SENSITIVE_VALUE");
    }
    for value in vectors.allowed {
        let directory = tempdir().expect("temporary project directory");
        let store = ProjectStore::new(directory.path().to_path_buf());
        store
            .save(request(
                "demo-project",
                valid_json("demo-project", json!({ "value": value })),
            ))
            .expect("route or URL vector is allowed");
    }
}

#[test]
fn project_store_allows_exactly_five_mibibytes() {
    let directory = tempdir().expect("temporary project directory");
    let store = ProjectStore::new(directory.path().to_path_buf());
    let json = exact_size_json("limit-project", MAX_PROJECT_BYTES);

    let saved = store
        .save(request("limit-project", json))
        .expect("exact limit is allowed");

    assert_eq!(saved.bytes, 5_242_880);
}

#[test]
fn project_store_counts_and_hashes_exact_unicode_utf8_bytes() {
    let directory = tempdir().expect("temporary project directory");
    let store = ProjectStore::new(directory.path().to_path_buf());
    let json = concat!(
        "{\"schemaVersion\":\"blocky.spike-project/v1\",",
        "\"projectId\":\"unicode-project\",",
        "\"workspace\":{\"text\":\"你好🙂\"},",
        "\"program\":{},\"interactionManifest\":{}}"
    );

    let saved = store
        .save(request("unicode-project", json.to_owned()))
        .expect("Unicode project is saved");

    assert_eq!(saved.bytes, 145);
    assert_eq!(
        saved.sha256,
        "ee8e664e5e46036a45ef0c9f272a2c634a16836f15ae5d36cdb4eb7f6d985846"
    );
}

#[test]
fn project_store_rejects_non_object_json_as_invalid() {
    let directory = tempdir().expect("temporary project directory");
    let store = ProjectStore::new(directory.path().to_path_buf());

    let error = store
        .save(request("demo-project", "[]".to_owned()))
        .expect_err("non-object JSON is not a project document");

    assert_eq!(error.code, "PROJECT_JSON_INVALID");
}

#[test]
fn project_store_accepts_unknown_root_keys_for_bridge_layer_validation() {
    let directory = tempdir().expect("temporary project directory");
    let store = ProjectStore::new(directory.path().to_path_buf());
    let json = json!({
        "schemaVersion": "blocky.spike-project/v1",
        "projectId": "demo-project",
        "workspace": {},
        "program": {},
        "interactionManifest": {},
        "unexpected": "value",
    })
    .to_string();

    let saved = store
        .save(request("demo-project", json.clone()))
        .expect("Rust store accepts unknown root keys");
    let loaded = store.load("demo-project").expect("stored JSON reloads");

    assert_eq!(saved.json, json);
    assert_eq!(loaded.json, json);
}

#[test]
fn project_store_rejects_corrupt_and_oversized_files_on_load() {
    let directory = tempdir().expect("temporary project directory");
    fs::write(directory.path().join("corrupt-project.json"), [0xff, 0xfe])
        .expect("corrupt fixture is written");
    fs::write(
        directory.path().join("oversized-project.json"),
        vec![b'x'; MAX_PROJECT_BYTES + 1],
    )
    .expect("oversized fixture is written");
    let store = ProjectStore::new(directory.path().to_path_buf());

    assert_eq!(
        store
            .load("corrupt-project")
            .expect_err("corrupt load fails")
            .code,
        "PROJECT_JSON_INVALID"
    );
    assert_eq!(
        store
            .load("oversized-project")
            .expect_err("oversized load fails")
            .code,
        "PROJECT_TOO_LARGE"
    );
}

#[test]
fn project_store_io_errors_are_fixed_and_do_not_leak_paths() {
    let directory = tempdir().expect("temporary project directory");
    let blocked_root = directory.path().join("blocked-root");
    fs::write(&blocked_root, b"not a directory").expect("root blocker is written");
    let create_error = ProjectStore::new(blocked_root.clone())
        .save(request("demo-project", EXACT_JSON.to_owned()))
        .expect_err("directory creation fails");
    assert_eq!(create_error.code, "PROJECT_DIRECTORY_CREATE_FAILED");
    assert_eq!(create_error.message, "保存项目失败，请重试");
    assert!(
        !create_error
            .message
            .contains(blocked_root.to_string_lossy().as_ref())
    );

    #[cfg(windows)]
    {
        use std::fs::OpenOptions;
        use std::os::windows::fs::OpenOptionsExt;

        let read_root = directory.path().join("read-root");
        fs::create_dir(&read_root).expect("read root is created");
        let target = read_root.join("demo-project.json");
        fs::write(&target, EXACT_JSON).expect("read fixture is written");
        let _exclusive = OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(&target)
            .expect("exclusive read fixture is opened");
        let read_error = ProjectStore::new(read_root.clone())
            .load("demo-project")
            .expect_err("sharing violation makes the read fail");
        assert_eq!(read_error.code, "PROJECT_READ_FAILED");
        assert_eq!(read_error.message, "读取项目失败，请重试");
        assert!(
            !read_error
                .message
                .contains(read_root.to_string_lossy().as_ref())
        );
    }
}

#[test]
fn project_store_rejects_non_file_target_before_creating_atomic_temp_files() {
    let directory = tempdir().expect("temporary project directory");
    let target = directory.path().join("demo-project.json");
    fs::create_dir(&target).expect("directory target is created");
    let store = ProjectStore::new(directory.path().to_path_buf());

    let error = store
        .save(request("demo-project", EXACT_JSON.to_owned()))
        .expect_err("directory target is rejected before write");
    let entries = fs::read_dir(directory.path())
        .expect("project root is readable")
        .map(|entry| entry.expect("directory entry is readable").file_name())
        .collect::<Vec<_>>();

    assert_eq!(error.code, "PROJECT_PATH_UNSAFE");
    assert_eq!(error.message, "项目存储路径不安全");
    assert_eq!(
        entries,
        vec![target.file_name().expect("target name").to_owned()]
    );
}

#[test]
fn project_store_successful_atomic_write_leaves_only_the_final_file() {
    let directory = tempdir().expect("temporary project directory");
    let store = ProjectStore::new(directory.path().to_path_buf());

    store
        .save(request("demo-project", EXACT_JSON.to_owned()))
        .expect("atomic save succeeds");
    let entries = fs::read_dir(directory.path())
        .expect("project root is readable")
        .map(|entry| entry.expect("directory entry is readable").file_name())
        .collect::<Vec<_>>();

    assert_eq!(entries, vec![std::ffi::OsString::from("demo-project.json")]);
}

#[cfg(windows)]
#[test]
fn project_store_commit_failure_removes_only_its_new_atomic_temp_file() {
    use std::fs::OpenOptions;
    use std::os::windows::fs::OpenOptionsExt;

    let directory = tempdir().expect("temporary project directory");
    let target = directory.path().join("demo-project.json");
    let existing_temp = directory.path().join(".demo-project.json.ABC123");
    let other_project_temp = directory.path().join(".other-project.json.XYZ789");
    let near_match = directory.path().join(".demo-project.json.ABC12");
    let store = ProjectStore::new(directory.path().to_path_buf());
    store
        .save(request("demo-project", EXACT_JSON.to_owned()))
        .expect("initial save succeeds");
    fs::write(&existing_temp, b"existing-temp").expect("existing temp fixture is written");
    fs::write(&other_project_temp, b"other-project").expect("other project fixture is written");
    fs::write(&near_match, b"near-match").expect("near match fixture is written");

    let exclusive = OpenOptions::new()
        .read(true)
        .share_mode(0)
        .open(&target)
        .expect("target is locked against replacement");
    let error = store
        .save(request(
            "demo-project",
            valid_json("demo-project", json!({ "revision": 2 })),
        ))
        .expect_err("locked target makes atomic commit fail");
    drop(exclusive);
    let mut entries = fs::read_dir(directory.path())
        .expect("project root is readable")
        .map(|entry| entry.expect("directory entry is readable").file_name())
        .collect::<Vec<_>>();
    entries.sort();
    let mut expected = vec![
        target.file_name().expect("target name").to_owned(),
        existing_temp
            .file_name()
            .expect("existing temp name")
            .to_owned(),
        other_project_temp
            .file_name()
            .expect("other project temp name")
            .to_owned(),
        near_match.file_name().expect("near match name").to_owned(),
    ];
    expected.sort();

    assert_eq!(error.code, "PROJECT_WRITE_COMMIT_FAILED");
    assert_eq!(error.message, "保存项目失败，请重试");
    assert_eq!(entries, expected);
    assert_eq!(
        fs::read_to_string(&target).expect("original remains"),
        EXACT_JSON
    );
    assert_eq!(
        fs::read(&existing_temp).expect("existing temp remains"),
        b"existing-temp"
    );
    assert_eq!(
        fs::read(&other_project_temp).expect("other project remains"),
        b"other-project"
    );
    assert_eq!(
        fs::read(&near_match).expect("near match remains"),
        b"near-match"
    );
}

#[cfg(windows)]
#[test]
fn project_store_commit_failure_never_deletes_a_foreign_temp_created_in_flight() {
    use std::fs::OpenOptions;
    use std::os::windows::fs::OpenOptionsExt;
    use std::sync::mpsc;
    use std::thread;
    use std::time::{Duration, Instant};

    let directory = tempdir().expect("temporary project directory");
    let root = directory.path().to_path_buf();
    let target = root.join("demo-project.json");
    let foreign = root.join(".demo-project.json.OWN999");
    let store = ProjectStore::new(root.clone());
    store
        .save(request("demo-project", EXACT_JSON.to_owned()))
        .expect("initial save succeeds");
    let exclusive = OpenOptions::new()
        .read(true)
        .share_mode(0)
        .open(&target)
        .expect("target is locked against replacement");

    let (ready_tx, ready_rx) = mpsc::sync_channel(0);
    let observer_root = root.clone();
    let observer_foreign = foreign.clone();
    let observer = thread::spawn(move || {
        ready_tx.send(()).expect("observer announces readiness");
        let prefix = ".demo-project.json.";
        let deadline = Instant::now() + Duration::from_secs(10);
        while Instant::now() < deadline {
            let owned_temp_exists = fs::read_dir(&observer_root)
                .expect("project root remains readable")
                .filter_map(Result::ok)
                .filter_map(|entry| entry.file_name().into_string().ok())
                .any(|name| {
                    name.starts_with(prefix)
                        && name.len() == prefix.len() + 6
                        && name != ".demo-project.json.OWN999"
                });
            if owned_temp_exists {
                fs::write(&observer_foreign, b"foreign-owned")
                    .expect("lock-external writer creates its own temp");
                return true;
            }
            thread::yield_now();
        }
        false
    });
    ready_rx.recv().expect("observer is ready before save");

    let error = store
        .save(request(
            "demo-project",
            exact_size_json("demo-project", MAX_PROJECT_BYTES),
        ))
        .expect_err("locked target makes atomic commit fail");
    let injected = observer.join().expect("observer does not panic");
    drop(exclusive);
    let mut matching_temps = fs::read_dir(&root)
        .expect("project root is readable")
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| {
                    let prefix = ".demo-project.json.";
                    name.starts_with(prefix) && name.len() == prefix.len() + 6
                })
        })
        .collect::<Vec<_>>();
    matching_temps.sort();

    assert!(
        injected,
        "observer must inject during the owned temp window"
    );
    assert_eq!(error.code, "PROJECT_WRITE_COMMIT_FAILED");
    assert_eq!(error.message, "保存项目失败，请重试");
    assert_eq!(matching_temps, vec![foreign.clone()]);
    assert_eq!(
        fs::read(&foreign).expect("foreign temp remains"),
        b"foreign-owned"
    );
    assert_eq!(
        fs::read_to_string(&target).expect("original remains"),
        EXACT_JSON
    );
}

#[test]
fn concurrent_saves_of_one_project_leave_one_complete_snapshot_and_no_temp_files() {
    use std::sync::{Arc, Barrier};
    use std::thread;

    const WRITERS: usize = 12;
    let directory = tempdir().expect("temporary project directory");
    let root = directory.path().to_path_buf();
    let barrier = Arc::new(Barrier::new(WRITERS));
    let snapshots = (0..WRITERS)
        .map(|revision| valid_json("demo-project", json!({ "revision": revision })))
        .collect::<Vec<_>>();
    let handles = snapshots
        .iter()
        .cloned()
        .map(|snapshot| {
            let barrier = Arc::clone(&barrier);
            let root = root.clone();
            thread::spawn(move || {
                barrier.wait();
                ProjectStore::new(root).save(request("demo-project", snapshot))
            })
        })
        .collect::<Vec<_>>();

    for handle in handles {
        handle
            .join()
            .expect("save thread does not panic")
            .expect("concurrent save succeeds");
    }
    let final_json = fs::read_to_string(root.join("demo-project.json"))
        .expect("one complete project snapshot remains");
    assert!(snapshots.contains(&final_json));
    assert_eq!(
        fs::read_dir(&root)
            .expect("project root is readable")
            .count(),
        1
    );
}

#[test]
fn project_store_rejects_symlinked_root_before_save() {
    let directory = tempdir().expect("temporary project directory");
    let real_root = directory.path().join("real-root");
    let linked_root = directory.path().join("linked-root");
    fs::create_dir(&real_root).expect("real root is created");
    create_directory_symlink(&real_root, &linked_root)
        .expect("directory symlink must be available for the safety test");

    let error = ProjectStore::new(linked_root)
        .save(request("demo-project", EXACT_JSON.to_owned()))
        .expect_err("symlink root is rejected");

    assert_eq!(error.code, "PROJECT_PATH_UNSAFE");
    assert_eq!(error.message, "项目存储路径不安全");
}

#[test]
fn project_store_rejects_symlinked_target_before_load_or_save() {
    let directory = tempdir().expect("temporary project directory");
    let outside = directory.path().join("outside.json");
    let target = directory.path().join("demo-project.json");
    fs::write(&outside, EXACT_JSON).expect("outside fixture is written");
    create_file_symlink(&outside, &target)
        .expect("file symlink must be available for the safety test");
    let store = ProjectStore::new(directory.path().to_path_buf());

    let load_error = store
        .load("demo-project")
        .expect_err("symlink target is rejected on load");
    let save_error = store
        .save(request("demo-project", EXACT_JSON.to_owned()))
        .expect_err("symlink target is rejected on save");

    assert_eq!(load_error.code, "PROJECT_PATH_UNSAFE");
    assert_eq!(save_error.code, "PROJECT_PATH_UNSAFE");
    assert_eq!(
        fs::read_to_string(outside).expect("outside file is intact"),
        EXACT_JSON
    );
}
