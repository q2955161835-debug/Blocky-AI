use super::*;
use serde_json::{Value, json};
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
};
fn git(root: &Path, args: &[&str]) -> String {
    let output = Command::new("git")
        .arg("-C")
        .arg(root)
        .args([
            "-c",
            "user.name=Conversion Test",
            "-c",
            "user.email=test@example.invalid",
            "-c",
            "core.autocrlf=false",
        ])
        .args(args)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "fixture Git failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8(output.stdout).unwrap().trim().to_owned()
}
fn fixture() -> (tempfile::TempDir, ConversionStore, PathBuf) {
    let parent = std::env::current_dir().unwrap().join("../../try/stage3");
    fs::create_dir_all(&parent).unwrap();
    let dir = tempfile::tempdir_in(parent).unwrap();
    let repo = dir.path().join("repo");
    fs::create_dir_all(repo.join("src")).unwrap();
    fs::create_dir_all(repo.join("other")).unwrap();
    fs::write(
        repo.join("LICENSE"),
        "Copyright Example\nMIT license fixture body\n",
    )
    .unwrap();
    fs::write(
        repo.join("package.json"),
        "{\"name\":\"fixture\",\"scripts\":{\"postinstall\":\"echo forbidden\"}}",
    )
    .unwrap();
    fs::write(
        repo.join("src/a.ts"),
        "export const add = (a: number, b: number) => a + b;\n",
    )
    .unwrap();
    fs::write(repo.join("other/outside.ts"), "outside scope body\n").unwrap();
    git(&repo, &["init", "--quiet"]);
    git(&repo, &["add", "."]);
    git(&repo, &["commit", "--quiet", "-m", "fixture"]);
    let store = ConversionStore::new(dir.path().join("conversion"));
    (dir, store, repo)
}
fn scan(store: &ConversionStore, repo: &Path) -> Value {
    dispatch(store,&json!({"operation":"conversion-scan","projectId":"project.one","path":repo,"subdir":"src"})).unwrap()
}
fn read(store: &ConversionStore, id: &Value, cursor: usize) -> Result<Value, String> {
    dispatch(
        store,
        &json!({"operation":"conversion-read","projectId":"project.one","artifactId":id,"cursor":cursor}),
    )
}
#[test]
fn locked_scope_includes_root_evidence_and_never_runs_filters() {
    let (_dir, store, repo) = fixture();
    let commit = git(&repo, &["rev-parse", "HEAD"]);
    fs::write(repo.join(".gitattributes"), "src/a.ts filter=probe\n").unwrap();
    git(
        &repo,
        &[
            "config",
            "filter.probe.clean",
            "echo executed > FILTER_EXECUTED; cat",
        ],
    );
    fs::write(repo.join("src/a.ts"), "dirty worktree content\n").unwrap();
    let result = scan(&store, &repo);
    assert_eq!(result["commit"], commit);
    assert_eq!(result["dirty"], "true");
    assert_eq!(result["repository"], "local-repository");
    assert!(!repo.join("FILTER_EXECUTED").exists());
    let page = read(&store, &result["artifactId"], 0).unwrap();
    let files = page["files"].as_array().unwrap();
    assert_eq!(files.len(), 3);
    assert!(
        files
            .iter()
            .any(|f| f["path"] == "src/a.ts" && f["content"].as_str().unwrap().contains("a + b"))
    );
    assert!(!files.iter().any(|f| f["path"] == "other/outside.ts"));
    assert!(
        !page
            .to_string()
            .contains(&repo.to_string_lossy().to_string())
    );
    let again = scan(&store, &repo);
    assert_eq!(again["artifactId"], result["artifactId"]);
    assert_eq!(again["cacheHit"], true);
    fs::write(repo.join("other/outside.ts"), "changed outside scope").unwrap();
    assert_eq!(scan(&store, &repo)["snapshotId"], result["snapshotId"]);
}
#[test]
fn pages_restart_cross_project_and_artifact_tampering() {
    let (dir, store, repo) = fixture();
    for n in 0..70 {
        fs::write(
            repo.join(format!("src/file{n:03}.py")),
            format!("value = {n}\n"),
        )
        .unwrap();
    }
    git(&repo, &["add", "."]);
    git(&repo, &["commit", "--quiet", "-m", "pages"]);
    let result = scan(&store, &repo);
    let first = read(&store, &result["artifactId"], 0).unwrap();
    assert_eq!(first["files"].as_array().unwrap().len(), 64);
    assert_eq!(first["nextCursor"], 64);
    let restarted = ConversionStore::new(dir.path().join("conversion"));
    let second = read(&restarted, &result["artifactId"], 64).unwrap();
    assert_eq!(second["snapshotId"], first["snapshotId"]);
    assert_eq!(second["files"].as_array().unwrap().len(), 9);
    assert!(second["nextCursor"].is_null());
    assert!(dispatch(&store,&json!({"operation":"conversion-read","projectId":"another","artifactId":result["artifactId"]})).is_err());
    let project = store.scope("project.one").unwrap();
    let artifact = project
        .join(result["artifactId"].as_str().unwrap())
        .join("snapshot.jsonl");
    let mut bytes = fs::read(&artifact).unwrap();
    let last = bytes.len() - 2;
    bytes[last] ^= 1;
    fs::write(&artifact, bytes).unwrap();
    assert_eq!(
        read(&store, &result["artifactId"], 0).unwrap_err(),
        "BLK-CONVERT-CORRUPT"
    );
}
#[test]
fn excludes_secrets_binary_generated_and_oversize_with_reasons() {
    let (_dir, store, repo) = fixture();
    fs::write(repo.join("src/.env"), "PRIVATE=hidden").unwrap();
    fs::write(repo.join("src/data.ts"), b"a\0binary").unwrap();
    fs::write(repo.join("src/bundle.min.js"), "generated").unwrap();
    fs::write(repo.join("src/large.ts"), vec![b'x'; 2 * 1024 * 1024 + 1]).unwrap();
    git(&repo, &["add", "."]);
    git(&repo, &["commit", "--quiet", "-m", "excluded"]);
    let result = scan(&store, &repo);
    let page = read(&store, &result["artifactId"], 0).unwrap();
    let reasons = page["excluded"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v["reason"].as_str().unwrap())
        .collect::<Vec<_>>();
    for reason in [
        "secret-file",
        "binary-content",
        "generated-file",
        "document-too-large",
    ] {
        assert!(reasons.contains(&reason));
    }
    assert!(!page.to_string().contains("PRIVATE=hidden"));
}
#[test]
fn analysis_cache_binds_existing_snapshot_and_reuses_project_hash_map() {
    let (_dir, store, repo) = fixture();
    let result = scan(&store, &repo);
    let id = &result["snapshotId"];
    assert_eq!(
        dispatch(
            &store,
            &json!({"operation":"conversion-cache-load","projectId":"project.one","snapshotId":id})
        )
        .unwrap(),
        json!({"value":null,"analysisCache":null})
    );
    let request = json!({"operation":"conversion-cache-save","projectId":"project.one","snapshotId":id,"value":{"cursor":1},"analysisCache":{"sha":{"schemaVersion":1,"ast":[]}}});
    dispatch(&store, &request).unwrap();
    let loaded = dispatch(
        &store,
        &json!({"operation":"conversion-cache-load","projectId":"project.one","snapshotId":id}),
    )
    .unwrap();
    assert_eq!(loaded["value"]["cursor"], 1);
    assert_eq!(loaded["analysisCache"]["sha"]["schemaVersion"], 1);
    assert!(dispatch(&store,&json!({"operation":"conversion-cache-save","projectId":"project.one","snapshotId":"snap-missing","value":{}})).is_err());
    fs::write(repo.join("src/a.ts"), "export const newer = 2;\n").unwrap();
    git(&repo, &["add", "."]);
    git(&repo, &["commit", "--quiet", "-m", "new snapshot"]);
    let newer = scan(&store, &repo);
    assert_ne!(newer["snapshotId"], *id);
    let reused=dispatch(&store,&json!({"operation":"conversion-cache-load","projectId":"project.one","snapshotId":newer["snapshotId"]})).unwrap();
    assert!(reused["value"].is_null());
    assert_eq!(reused["analysisCache"], loaded["analysisCache"]);
    let cache = store
        .scope("project.one")
        .unwrap()
        .join("analysis-cache.json");
    let mut forged: Value = serde_json::from_slice(&fs::read(&cache).unwrap()).unwrap();
    forged["value"]["sha"]["ast"] = json!(["tampered"]);
    fs::write(&cache, serde_json::to_vec(&forged).unwrap()).unwrap();
    assert_eq!(
        dispatch(
            &store,
            &json!({"operation":"conversion-cache-load","projectId":"project.one","snapshotId":id})
        )
        .unwrap_err(),
        "BLK-CONVERT-CORRUPT"
    );
}
#[test]
fn cache_size_bound_preserves_previous_checkpoint() {
    let (_dir, store, repo) = fixture();
    let result = scan(&store, &repo);
    let id = &result["snapshotId"];
    dispatch(&store,&json!({"operation":"conversion-cache-save","projectId":"project.one","snapshotId":id,"value":{"cursor":1}})).unwrap();
    assert_eq!(dispatch(&store,&json!({"operation":"conversion-cache-save","projectId":"project.one","snapshotId":id,"value":"x".repeat(16*1024*1024)})).unwrap_err(),"BLK-CONVERT-LIMIT");
    assert_eq!(
        dispatch(
            &store,
            &json!({"operation":"conversion-cache-load","projectId":"project.one","snapshotId":id})
        )
        .unwrap()["value"]["cursor"],
        1
    );
}
#[test]
fn rejects_invalid_ids_scopes_and_unknown_fields() {
    let (_dir, store, repo) = fixture();
    for subdir in [
        "../src",
        "src/../other",
        "C:/private",
        "src\\a",
        ":(glob)*",
        "/src",
    ] {
        assert!(dispatch(&store,&json!({"operation":"conversion-scan","projectId":"project.one","path":repo,"subdir":subdir})).is_err());
    }
    assert!(
        dispatch(
            &store,
            &json!({"operation":"conversion-cancel","projectId":"../escape"})
        )
        .is_err()
    );
    assert!(dispatch(&store,&json!({"operation":"conversion-scan","projectId":"project.one","path":repo,"shell":"execute"})).is_err());
}

#[test]
fn complete_unpublished_artifact_recovers_after_interrupted_publication() {
    let (_dir, store, repo) = fixture();
    let result = scan(&store, &repo);
    fs::remove_file(
        store
            .scope("project.one")
            .unwrap()
            .join(format!("{}.ref", result["snapshotId"].as_str().unwrap())),
    )
    .unwrap();
    assert!(read(&store, &result["artifactId"], 0).is_err());
    let resumed = scan(&store, &repo);
    assert_eq!(resumed["artifactId"], result["artifactId"]);
    assert!(read(&store, &result["artifactId"], 0).is_ok());
}

#[test]
fn cancel_settles_scan_without_replacing_existing_snapshot() {
    let (_dir, store, repo) = fixture();
    let original = scan(&store, &repo);
    for n in 0..24 {
        fs::write(
            repo.join(format!("src/large{n}.ts")),
            "export const message = 'hello';\n".repeat(30000),
        )
        .unwrap();
    }
    git(&repo, &["add", "."]);
    git(&repo, &["commit", "--quiet", "-m", "larger"]);
    let worker_store = store.clone();
    let worker_repo = repo.clone();
    let worker = std::thread::spawn(move || {
        dispatch(
            &worker_store,
            &json!({"operation":"conversion-scan","projectId":"project.one","path":worker_repo,"subdir":"src"}),
        )
    });
    std::thread::sleep(std::time::Duration::from_millis(60));
    let started = std::time::Instant::now();
    dispatch(
        &store,
        &json!({"operation":"conversion-cancel","projectId":"project.one"}),
    )
    .unwrap();
    assert_eq!(worker.join().unwrap().unwrap_err(), "BLK-CONVERT-CANCELLED");
    assert!(started.elapsed() < std::time::Duration::from_secs(5));
    assert!(read(&store, &original["artifactId"], 0).is_ok());
    let published = fs::read_dir(store.scope("project.one").unwrap())
        .unwrap()
        .filter_map(Result::ok)
        .filter(|entry| {
            entry
                .path()
                .extension()
                .is_some_and(|extension| extension == "ref")
        })
        .count();
    assert_eq!(published, 1);
    eprintln!(
        "CONVERSION_CANCEL settledMs={}",
        started.elapsed().as_millis()
    );
}

fn git_input(root: &Path, args: &[&str], input: &str) -> String {
    use std::{io::Write, process::Stdio};
    let mut child = Command::new("git")
        .arg("-C")
        .arg(root)
        .args([
            "-c",
            "user.name=Conversion Test",
            "-c",
            "user.email=test@example.invalid",
        ])
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    child
        .stdin
        .take()
        .unwrap()
        .write_all(input.as_bytes())
        .unwrap();
    let output = child.wait_with_output().unwrap();
    assert!(output.status.success(), "fixture object creation failed");
    String::from_utf8(output.stdout).unwrap().trim().into()
}
#[test]
fn small_scope_works_when_unselected_tree_exceeds_twenty_thousand_files() {
    let (_dir, store, repo) = fixture();
    let blob = git(&repo, &["rev-parse", "HEAD:other/outside.ts"]);
    let entries = (0..22000)
        .map(|n| format!("100644 blob {blob}\tfile{n:05}.ts\n"))
        .collect::<String>();
    let large = git_input(&repo, &["mktree"], &entries);
    let root = git_input(
        &repo,
        &["mktree"],
        &format!(
            "{}\n040000 tree {large}\toutside-large\n",
            git(&repo, &["ls-tree", "HEAD"])
        ),
    );
    let commit = git(
        &repo,
        &[
            "commit-tree",
            &root,
            "-p",
            "HEAD",
            "-m",
            "large unrelated tree",
        ],
    );
    let result=dispatch(&store,&json!({"operation":"conversion-scan","projectId":"project.one","path":repo,"ref":commit,"subdir":"src"})).unwrap();
    assert_eq!(result["fileCount"], 3);
    assert_eq!(dispatch(&store,&json!({"operation":"conversion-scan","projectId":"project.one","path":repo,"ref":commit})).unwrap_err(),"BLK-CONVERT-LIMIT");
}
#[test]
fn byte_bounded_pages_and_nested_repository_selection_rejection() {
    let (_dir, store, repo) = fixture();
    for n in 0..3 {
        fs::write(repo.join(format!("src/z{n}.ts")), "x".repeat(1_500_000)).unwrap();
    }
    git(&repo, &["add", "."]);
    git(&repo, &["commit", "--quiet", "-m", "byte pages"]);
    let result = scan(&store, &repo);
    let page = read(&store, &result["artifactId"], 0).unwrap();
    assert!(serde_json::to_vec(&page).unwrap().len() <= 4 * 1024 * 1024);
    assert!(page["nextCursor"].as_u64().is_some());
    let cursor = page["nextCursor"].as_u64().unwrap() as usize;
    let next = read(&store, &result["artifactId"], cursor).unwrap();
    assert!(next["nextCursor"].is_null());
    assert_eq!(
        page["files"].as_array().unwrap().len() + next["files"].as_array().unwrap().len(),
        6
    );
    assert!(dispatch(&store,&json!({"operation":"conversion-scan","projectId":"project.one","path":repo.join("src")})).is_err());
}
