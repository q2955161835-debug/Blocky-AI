use super::*;

#[test]
#[ignore = "requires both pinned embedding models and the reranker"]
fn real_model_migration_and_rerank_acl() {
    use serde_json::json;
    let dir = tempfile::tempdir_in(std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../try/agent-capability-upgrade")).unwrap();
    let source_path = dir.path().join("public.txt");
    std::fs::write(&source_path,"Public plants and banking notes.").unwrap();
    let store = KnowledgeStore::new(dir.path().join("store"));
    let source = store.add("p","c","file",source_path.to_str().unwrap(),None).unwrap();
    let sid = source["sourceId"].as_str().unwrap();
    let page = store.read_source("p","c",sid,None,None).unwrap();
    let head = store.load_index("p","c").unwrap();
    let generation = head["generation"].as_u64().unwrap();
    let texts = [("plants","Plants turn sunlight into food."),("bank","A bank offers loans to customers.")];
    let chunks = texts.iter().map(|(id,text)| json!({"chunkId":id,"sourceId":sid,"text":text,"digest":digest(text.as_bytes())})).collect::<Vec<_>>();
    let saved = store.save_index("p","c",head["revision"].as_u64().unwrap(),generation,json!({"schemaVersion":"blocky.knowledge-store/v1","index":{"schemaVersion":"blocky.knowledge-index/v1","generation":generation,"sources":{sid:page["revision"]},"documents":[],"chunks":chunks},"pending":null})).unwrap();
    let revision = saved["revision"].as_u64().unwrap();
    for id in [embedding_model::MODEL_ID,small_models::EMBED] { assert_eq!(embedding::build_index(&store,"p","c",id,revision,generation).unwrap()["embedded"],2); }
    let status = embedding::migration::status(&store,"p","c").unwrap();
    assert_eq!(status["models"].as_array().unwrap().len(),2);
    assert!(status["models"].as_array().unwrap().iter().all(|m| m["compatible"] == true));
    let ids = vec!["plants".into(),"bank".into()];
    assert_eq!(embedding::query(&store,"p","c",embedding_model::MODEL_ID,revision,generation,"bank loans",&ids,2).unwrap_err(),"BLK-EMBED-MODEL-MISMATCH");
    embedding::migration::activate(&store,"p","c",embedding_model::MODEL_ID,revision,generation).unwrap();
    assert_eq!(embedding::query(&store,"p","c",embedding_model::MODEL_ID,revision,generation,"bank loans",&ids,2).unwrap()["hits"][0]["chunkId"],"bank");
    let ranked = rerank::query(&store,"p","c",small_models::RERANK,revision,generation,"Where can I borrow money?",&ids).unwrap();
    assert_eq!(ranked["hits"][0]["chunkId"],"bank");
    assert_eq!(rerank::query(&store,"p","c",small_models::RERANK,revision,generation,"bank",&["foreign".into()]).unwrap_err(),DENIED);
    store.acl("p","c",sid,vec![]).unwrap();
    assert!(embedding::migration::activate(&store,"p","c",small_models::EMBED,revision,generation).is_err());
    assert!(rerank::query(&store,"p","c",small_models::RERANK,revision,generation,"bank",&ids).is_err());
    eprintln!("migration-evidence {}",json!({"models":status,"rankedModel":ranked["modelId"],"rollback":true,"revocationDenied":true,"externalApi":false}));
}
#[test]
fn locked_model_rejects_unknown_and_missing_assets() {
    assert_eq!(
        embedding_model::validate_id("random-vector-model").unwrap_err(),
        "BLK-EMBED-MODEL"
    );
    let dir =
        tempfile::tempdir_in(std::env::current_dir().unwrap().join("../../try/stage3")).unwrap();
    assert_eq!(
        embedding_model::verify_directory(dir.path()).unwrap_err(),
        "BLK-EMBED-MISSING"
    );
}
#[test]
fn vector_record_roundtrip_and_corruption_detection() {
    let key = digest(b"real-vector-cache-test");
    let mut vector = vec![0f32; 384];
    vector[2] = 1.;
    let record = embedding_binary::encode(&key, &vector).unwrap();
    assert_eq!(embedding_binary::decode(&record).unwrap(), (key, vector));
    let mut corrupt = record;
    corrupt[50] ^= 1;
    assert!(embedding_binary::decode(&corrupt).is_err());
}

#[test]
#[ignore = "requires the locked E5 assets through BLOCKY_MODEL_DIR; run explicitly for real inference"]
fn real_model_semantics_windows_binary_cache_and_revocation() {
    use serde_json::json;
    let start = std::time::Instant::now();
    let installed = embedding_model::install(embedding_model::MODEL_ID).unwrap();
    assert_eq!(installed["verified"], true);
    let plant = embedding_model::infer(
        "Plants use photosynthesis to turn sunlight and water into food.",
        false,
    )
    .unwrap();
    let git = embedding_model::infer(
        "Git tracks source code changes using commits and branches.",
        false,
    )
    .unwrap();
    let question = embedding_model::infer("植物如何利用阳光制造食物？", true).unwrap();
    let dot = |v: &[f32]| v.iter().zip(&question).map(|(a, b)| a * b).sum::<f32>();
    assert!(
        dot(&plant) > dot(&git),
        "cross-lingual semantic evidence should rank photosynthesis ahead of Git"
    );
    let long = "植物利用阳光进行光合作用，将水和二氧化碳转化为食物。".repeat(90);
    let windows = embedding_model::window_count(&long).unwrap();
    assert!(windows > 1);
    let vector = embedding_model::infer(&long, false).unwrap();
    assert_eq!(vector.len(), 384);
    let dir =
        tempfile::tempdir_in(std::env::current_dir().unwrap().join("../../try/stage3")).unwrap();
    let file = dir.path().join("lesson.md");
    std::fs::write(&file, "Plants use photosynthesis.\nGit records commits.\n").unwrap();
    let store = KnowledgeStore::new(dir.path().join("store"));
    let source = store
        .add("p", "c", "file", file.to_str().unwrap(), None)
        .unwrap();
    let id = source["sourceId"].as_str().unwrap();
    let page = store.read_source("p", "c", id, None, None).unwrap();
    let state = store.load_index("p", "c").unwrap();
    let generation = state["generation"].as_u64().unwrap();
    let value = json!({"schemaVersion":"blocky.knowledge-store/v1","index":{"schemaVersion":"blocky.knowledge-index/v1","generation":generation,"sources":{id:page["revision"]},"documents":[],"chunks":[{"chunkId":"plants","sourceId":id,"text":"Plants use photosynthesis to turn sunlight into food."},{"chunkId":"git","sourceId":id,"text":"Git tracks source changes using commits and branches."}]},"pending":null});
    let saved = store
        .save_index(
            "p",
            "c",
            state["revision"].as_u64().unwrap(),
            generation,
            value.clone(),
        )
        .unwrap();
    let revision = saved["revision"].as_u64().unwrap();
    let first = embedding::build_index(
        &store,
        "p",
        "c",
        embedding_model::MODEL_ID,
        revision,
        generation,
    )
    .unwrap();
    assert_eq!(first["embedded"], 2);
    let second = embedding::build_index(
        &store,
        "p",
        "c",
        embedding_model::MODEL_ID,
        revision,
        generation,
    )
    .unwrap();
    assert_eq!(second["embedded"], 0);
    assert_eq!(second["reused"], 2);
    let result = embedding::query(
        &store,
        "p",
        "c",
        embedding_model::MODEL_ID,
        revision,
        generation,
        "How do plants make food?",
        &["plants".into(), "git".into()],
        2,
    )
    .unwrap();
    assert_eq!(result["hits"][0]["chunkId"], "plants");
    // A row cannot alias another vector offset while retaining its own key.
    let published_path = store.scope("p", "c").unwrap().join("embedding.json");
    let original = std::fs::read(&published_path).unwrap();
    let mut altered: serde_json::Value = serde_json::from_slice(&original).unwrap();
    altered["rows"][1]["offset"] = altered["rows"][0]["offset"].clone();
    store::atomic_json(&published_path, &altered).unwrap();
    assert_eq!(
        embedding::query(
            &store,
            "p",
            "c",
            embedding_model::MODEL_ID,
            revision,
            generation,
            "plants",
            &["plants".into(), "git".into()],
            2
        )
        .unwrap_err(),
        "BLK-EMBED-CORRUPT"
    );
    store::atomic_bytes(&published_path, &original).unwrap();
    let subset = embedding::query(
        &store,
        "p",
        "c",
        embedding_model::MODEL_ID,
        revision,
        generation,
        "How do plants make food?",
        &["git".into()],
        2,
    )
    .unwrap();
    assert_eq!(subset["candidateCount"], 1);
    assert_eq!(subset["hits"][0]["chunkId"], "git");
    assert!(
        embedding::query(
            &store,
            "p",
            "c",
            embedding_model::MODEL_ID,
            revision,
            generation,
            "test",
            &["forged".into()],
            2
        )
        .is_err()
    );
    let mut changed = value;
    changed["index"]["chunks"][1]["text"] = "Git also uses tags to name versions.".into();
    let saved = store
        .save_index("p", "c", revision, generation, changed)
        .unwrap();
    let revision = saved["revision"].as_u64().unwrap();
    let incremental = embedding::build_index(
        &store,
        "p",
        "c",
        embedding_model::MODEL_ID,
        revision,
        generation,
    )
    .unwrap();
    assert_eq!(incremental["embedded"], 1);
    assert_eq!(incremental["reused"], 1);
    store.acl("p", "c", id, vec![]).unwrap();
    assert!(
        embedding::query(
            &store,
            "p",
            "c",
            embedding_model::MODEL_ID,
            revision,
            generation,
            "test",
            &["plants".into()],
            1
        )
        .is_err()
    );
    eprintln!(
        "REAL_EMBEDDING {}",
        json!({"modelId":embedding_model::MODEL_ID,"modelSha256":embedding_model::MODEL_SHA,"dimension":plant.len(),"plantSimilarity":dot(&plant),"unrelatedSimilarity":dot(&git),"longTextWindows":windows,"first":first,"repeat":second,"incremental":incremental,"query":result,"elapsedMs":start.elapsed().as_millis(),"externalApi":false})
    );
}

#[test]
#[ignore = "requires locked E5 model assets; exercises real inference cancellation and persisted resume"]
fn real_embedding_cancel_resumes_binary_checkpoint_and_rejects_corruption() {
    use serde_json::json;
    use std::{
        fs,
        io::{Seek, SeekFrom, Write},
        time::{Duration, Instant},
    };
    let dir =
        tempfile::tempdir_in(std::env::current_dir().unwrap().join("../../try/stage3")).unwrap();
    let file = dir.path().join("source.md");
    fs::write(
        &file,
        "A local source for embedding checkpoint verification",
    )
    .unwrap();
    let store = KnowledgeStore::new(dir.path().join("store"));
    let source = store
        .add("p", "c", "file", file.to_str().unwrap(), None)
        .unwrap();
    let source_id = source["sourceId"].as_str().unwrap();
    let current = store.load_index("p", "c").unwrap();
    let generation = current["generation"].as_u64().unwrap();
    let chunks=(0..32).map(|n|json!({"chunkId":format!("chunk-{n}"),"sourceId":source_id,"text":format!("Lesson {n}: Plants use sunlight to grow. This lesson explains the role of water, roots, leaves and carbon dioxide.")})).collect::<Vec<_>>();
    let value = json!({"schemaVersion":"blocky.knowledge-store/v1","index":{"generation":generation,"sources":{source_id:"revision"},"documents":[],"chunks":chunks},"pending":null});
    let saved = store
        .save_index(
            "p",
            "c",
            current["revision"].as_u64().unwrap(),
            generation,
            value,
        )
        .unwrap();
    let revision = saved["revision"].as_u64().unwrap();
    let worker_store = store.clone();
    let worker = std::thread::spawn(move || {
        embedding::build_index(
            &worker_store,
            "p",
            "c",
            embedding_model::MODEL_ID,
            revision,
            generation,
        )
    });
    let scope = store.scope("p", "c").unwrap();
    let start = Instant::now();
    loop {
        let progress = fs::read(scope.join("embedding-progress.json"))
            .ok()
            .and_then(|b| serde_json::from_slice::<serde_json::Value>(&b).ok());
        if progress
            .as_ref()
            .is_some_and(|v| v["completed"].as_u64().unwrap_or(0) >= 16)
        {
            break;
        }
        assert!(
            start.elapsed() < Duration::from_secs(45),
            "embedding did not reach a durable checkpoint"
        );
        std::thread::sleep(Duration::from_millis(10));
    }
    let cancel_started = Instant::now();
    store.cancel("p", "c").unwrap();
    assert_eq!(worker.join().unwrap().unwrap_err(), "BLK-KNOW-CANCELLED");
    let cancel_ms = cancel_started.elapsed().as_millis();
    assert!(cancel_ms < 5000);
    assert!(!scope.join("embedding.json").exists());
    let reopened = KnowledgeStore::new(store.root.clone());
    let resumed = embedding::build_index(
        &reopened,
        "p",
        "c",
        embedding_model::MODEL_ID,
        revision,
        generation,
    )
    .unwrap();
    assert!(resumed["reused"].as_u64().unwrap() >= 16);
    assert_eq!(resumed["chunkCount"], 32);
    let pack = scope.join(format!("vectors-{}.bin", embedding_model::signature()));
    let mut corrupt = fs::OpenOptions::new().write(true).open(&pack).unwrap();
    corrupt.seek(SeekFrom::Start(50)).unwrap();
    corrupt.write_all(&[0, 0, 0, 0, 0, 0, 0, 0]).unwrap();
    drop(corrupt);
    assert_eq!(
        embedding::query(
            &reopened,
            "p",
            "c",
            embedding_model::MODEL_ID,
            revision,
            generation,
            "water and sunlight",
            &["chunk-0".into()],
            1
        )
        .unwrap_err(),
        "BLK-EMBED-CORRUPT"
    );
    eprintln!(
        "REAL_EMBEDDING_RECOVERY {}",
        json!({"cancelMs":cancel_ms,"resumed":resumed,"corruptVectorRejected":true})
    );
}

#[test]
fn interrupted_binary_tail_is_recovered_without_accepting_corrupt_complete_records() {
    use std::{fs, io::Write};
    let dir =
        tempfile::tempdir_in(std::env::current_dir().unwrap().join("../../try/stage3")).unwrap();
    let path = dir.path().join("vectors.bin");
    let key = digest(b"record");
    let mut vector = vec![0f32; 384];
    vector[0] = 1.;
    let mut cache = embedding_binary::Cache::open(&path).unwrap();
    cache.append(&key, &vector).unwrap();
    cache.checkpoint().unwrap();
    drop(cache);
    let mut file = fs::OpenOptions::new().append(true).open(&path).unwrap();
    file.write_all(b"partial interrupted record").unwrap();
    drop(file);
    let recovered = embedding_binary::Cache::open(&path).unwrap();
    assert_eq!(recovered.entries.len(), 1);
    assert_eq!(
        fs::metadata(&path).unwrap().len(),
        embedding_binary::RECORD as u64
    );
    drop(recovered);
    let mut bad = embedding_binary::encode(&key, &vector).unwrap();
    bad[100] ^= 1;
    let mut file = fs::OpenOptions::new().append(true).open(&path).unwrap();
    file.write_all(&bad).unwrap();
    drop(file);
    assert!(embedding_binary::Cache::open(&path).is_err());
}
