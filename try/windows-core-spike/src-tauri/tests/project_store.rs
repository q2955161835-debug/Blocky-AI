use blocky_windows_core_spike_lib::project_store::{
    MAX_PROJECT_BYTES, ProjectStore, SaveProjectRequest,
};
use serde_json::{Value, json};
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
