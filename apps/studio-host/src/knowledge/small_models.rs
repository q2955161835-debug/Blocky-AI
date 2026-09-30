//! Additional pinned CPU models share the existing local inference boundary.
use super::*;
use fastembed::{
    InitOptionsUserDefined, Pooling, QuantizationMode, RerankInitOptionsUserDefined, TextEmbedding,
    TextRerank, TokenizerFiles, UserDefinedEmbeddingModel, UserDefinedRerankingModel,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
    time::Duration,
};
pub const EMBED: &str = "minilm-l6-v2-int8-v1";
pub const RERANK: &str = "ms-marco-minilm-l6-v2-int8-v1";
#[derive(Deserialize)]
struct Asset {
    name: String,
    bytes: usize,
    sha256: String,
}
#[derive(Deserialize)]
struct Definition {
    id: String,
    kind: String,
    upstream: String,
    repo: String,
    revision: String,
    dimension: usize,
    license: String,
    files: Vec<Asset>,
}
fn definition(id: &str) -> Result<Definition, String> {
    serde_json::from_str::<Vec<Definition>>(include_str!("models.json"))
        .map_err(|_| INVALID)?
        .into_iter()
        .find(|d| d.id == id)
        .ok_or_else(|| "BLK-EMBED-MODEL".into())
}
pub fn signature(id: &str) -> Result<String, String> {
    let d = definition(id)?;
    Ok(digest(
        format!(
            "{}:{}:{}:{}:{}",
            d.id,
            d.revision,
            d.dimension,
            d.files
                .iter()
                .map(|f| f.sha256.as_str())
                .collect::<Vec<_>>()
                .join(":"),
            if id == EMBED {
                "mean-l2-window250-max256-no-prefix-v1"
            } else {
                "pair-truncate512-logit-v1"
            }
        )
        .as_bytes(),
    ))
}
pub fn metadata(id: &str) -> Result<Value, String> {
    let d = definition(id)?;
    Ok(
        json!({"modelId":id,"kind":d.kind,"dimension":d.dimension,"modelRevision":d.revision,"modelSha256":d.files[0].sha256,"upstream":d.upstream,"repository":d.repo,"license":d.license,"languages":["en"],"backend":"onnx-cpu","externalApi":false,"signature":signature(id)?,"windowPolicy":if id==EMBED {"token-offset-250-weighted-mean-l2-v1"} else {"pair-truncate512-logit-v1"},"scoreMeaning":if id==RERANK {"logit-not-probability"} else {"cosine-similarity"}}),
    )
}
fn root(id: &str) -> Result<PathBuf, String> {
    definition(id)?;
    let path = if let Some(e5) = std::env::var_os("BLOCKY_MODEL_DIR") {
        PathBuf::from(e5).parent().ok_or(INVALID)?.join(id)
    } else {
        let exe = std::env::current_exe().map_err(|_| IO)?;
        let parent = exe.parent().ok_or(IO)?;
        let adjacent = parent.join("models").join(id);
        if adjacent.exists() {
            adjacent
        } else if parent.file_name().is_some_and(|n| n == "bin")
            && parent
                .parent()
                .and_then(Path::file_name)
                .is_some_and(|n| n == "cli")
        {
            parent
                .parent()
                .and_then(Path::parent)
                .ok_or(IO)?
                .join("models")
                .join(id)
        } else {
            adjacent
        }
    };
    if !path.exists() {
        return Err("BLK-EMBED-MISSING".into());
    }
    ingest::no_links(&path)?;
    path.canonicalize().map_err(|_| IO.into())
}
fn assets(path: &Path, id: &str) -> Result<Vec<Vec<u8>>, String> {
    definition(id)?
        .files
        .into_iter()
        .map(|a| {
            cancel::check()?;
            let bytes = store::read_bounded(&path.join(a.name), a.bytes)?;
            if bytes.len() != a.bytes || digest(&bytes) != a.sha256 {
                return Err("BLK-EMBED-MODEL-CORRUPT".into());
            }
            Ok(bytes)
        })
        .collect()
}
fn files(path: &Path, id: &str) -> Result<(Vec<u8>, TokenizerFiles), String> {
    let mut all = assets(path, id)?.into_iter();
    Ok((
        all.next().ok_or(INVALID)?,
        TokenizerFiles {
            tokenizer_file: all.next().ok_or(INVALID)?,
            config_file: all.next().ok_or(INVALID)?,
            special_tokens_map_file: all.next().ok_or(INVALID)?,
            tokenizer_config_file: all.next().ok_or(INVALID)?,
        },
    ))
}
struct EmbedLoaded {
    path: PathBuf,
    model: TextEmbedding,
    tokenizer: tokenizers::Tokenizer,
}
struct RerankLoaded {
    path: PathBuf,
    model: TextRerank,
}
static EMBEDDING: OnceLock<Mutex<Option<EmbedLoaded>>> = OnceLock::new();
static RERANKING: OnceLock<Mutex<Option<RerankLoaded>>> = OnceLock::new();
fn acquire<T>(mutex: &Mutex<T>) -> Result<std::sync::MutexGuard<'_, T>, String> {
    loop {
        cancel::check()?;
        match mutex.try_lock() {
            Ok(v) => return Ok(v),
            Err(std::sync::TryLockError::Poisoned(_)) => return Err("BLK-EMBED-INIT".into()),
            Err(_) => std::thread::sleep(Duration::from_millis(10)),
        }
    }
}
fn with_embed<T>(
    path: &Path,
    f: impl FnOnce(&mut EmbedLoaded) -> Result<T, String>,
) -> Result<T, String> {
    let mut cache = acquire(EMBEDDING.get_or_init(|| Mutex::new(None)))?;
    if cache.as_ref().is_none_or(|m| m.path != path) {
        let (onnx, tokenizer) = files(path, EMBED)?;
        tokenizers::utils::parallelism::set_parallelism(false);
        let model = TextEmbedding::try_new_from_user_defined(
            UserDefinedEmbeddingModel::new(onnx, tokenizer)
                .with_pooling(Pooling::Mean)
                .with_quantization(QuantizationMode::Dynamic),
            InitOptionsUserDefined::new()
                .with_max_length(256)
                .with_intra_threads(4),
        )
        .map_err(|_| "BLK-EMBED-INIT")?;
        let mut tokenizer = model.tokenizer.clone();
        tokenizer
            .with_truncation(None)
            .map_err(|_| "BLK-EMBED-TOKENIZE")?;
        tokenizer.with_padding(None);
        *cache = Some(EmbedLoaded {
            path: path.to_owned(),
            model,
            tokenizer,
        });
    }
    f(cache.as_mut().ok_or("BLK-EMBED-INIT")?)
}
fn with_rerank<T>(
    path: &Path,
    f: impl FnOnce(&mut TextRerank) -> Result<T, String>,
) -> Result<T, String> {
    let mut cache = acquire(RERANKING.get_or_init(|| Mutex::new(None)))?;
    if cache.as_ref().is_none_or(|m| m.path != path) {
        let (onnx, tokenizer) = files(path, RERANK)?;
        tokenizers::utils::parallelism::set_parallelism(false);
        let model = TextRerank::try_new_from_user_defined(
            UserDefinedRerankingModel::new(onnx, tokenizer),
            RerankInitOptionsUserDefined::new()
                .with_max_length(512)
                .with_intra_threads(4),
        )
        .map_err(|_| "BLK-RERANK-INIT")?;
        *cache = Some(RerankLoaded {
            path: path.to_owned(),
            model,
        });
    }
    f(&mut cache.as_mut().ok_or("BLK-RERANK-INIT")?.model)
}
pub fn status(id: &str) -> Result<Value, String> {
    let mut value = metadata(id)?;
    match root(id) {
        Err(e) if e == "BLK-EMBED-MISSING" => {
            value["available"] = false.into();
            value["verified"] = false.into();
            value["loaded"] = false.into();
        }
        Err(e) => return Err(e),
        Ok(path) => {
            value["available"] = true.into();
            let verified = assets(&path, id);
            value["verified"] = verified.is_ok().into();
            if let Err(e) = verified {
                value["code"] = e.into();
            }
            value["loaded"] = if id == EMBED {
                EMBEDDING
                    .get()
                    .and_then(|m| m.try_lock().ok())
                    .is_some_and(|m| m.as_ref().is_some_and(|m| m.path == path))
            } else {
                RERANKING
                    .get()
                    .and_then(|m| m.try_lock().ok())
                    .is_some_and(|m| m.as_ref().is_some_and(|m| m.path == path))
            }
            .into();
        }
    }
    Ok(value)
}
pub fn install(id: &str) -> Result<Value, String> {
    let path = root(id)?;
    if id == EMBED {
        with_embed(&path, |_| Ok(()))?;
    } else {
        with_rerank(&path, |_| Ok(()))?;
    }
    status(id)
}
pub fn infer(text: &str) -> Result<Vec<f32>, String> {
    infer_at(&root(EMBED)?, text)
}
fn infer_at(path: &Path, text: &str) -> Result<Vec<f32>, String> {
    if text.trim().is_empty() || text.len() > 65536 {
        return Err(INVALID.into());
    }
    with_embed(path, |loaded| {
        let parts = model_windows::windows(&loaded.tokenizer, text, None, 250, 256)?;
        let mut mean = vec![0f32; embedding_model::DIM];
        for (text, weight) in parts {
            cancel::check()?;
            let vectors = loaded
                .model
                .embed([text], Some(1))
                .map_err(|_| "BLK-EMBED-INFERENCE")?;
            let v = vectors.first().ok_or("BLK-EMBED-INFERENCE")?;
            embedding_model::validate_vector(v)?;
            for (sum, v) in mean.iter_mut().zip(v) {
                *sum += v * weight as f32;
            }
        }
        let norm = mean.iter().map(|v| (*v as f64).powi(2)).sum::<f64>().sqrt();
        if !norm.is_finite() || norm < 1e-12 {
            return Err("BLK-EMBED-INFERENCE".into());
        }
        for v in &mut mean {
            *v /= norm as f32;
        }
        embedding_model::validate_vector(&mean)?;
        cancel::check()?;
        Ok(mean)
    })
}
pub fn rerank(query: &str, texts: &[&str]) -> Result<Vec<f32>, String> {
    rerank_at(&root(RERANK)?, query, texts)
}
fn rerank_at(path: &Path, query: &str, texts: &[&str]) -> Result<Vec<f32>, String> {
    if query.trim().is_empty()
        || query.len() > 16384
        || texts.len() > 200
        || texts.iter().any(|t| t.trim().is_empty() || t.len() > 65536)
    {
        return Err(INVALID.into());
    }
    with_rerank(path, |model| {
        // One pair at a time permits cancellation between actual inferences.
        texts
            .iter()
            .map(|text| {
                cancel::check()?;
                let values = model
                    .rerank(query, [*text], false, Some(1))
                    .map_err(|_| "BLK-RERANK-INFERENCE")?;
                let score = values.first().ok_or("BLK-RERANK-INFERENCE")?.score;
                if !score.is_finite() {
                    return Err("BLK-RERANK-INFERENCE".into());
                }
                cancel::check()?;
                Ok(score)
            })
            .collect()
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    #[ignore = "requires pinned public model artifacts"]
    fn actual_minilm_embeddings_and_neural_ranking() {
        let base = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../try/agent-capability-upgrade/knowledge-models").canonicalize().unwrap();
        let started = std::time::Instant::now();
        let q = infer_at(&base.join(EMBED), "Where can I borrow money?").unwrap();
        let relevant = infer_at(&base.join(EMBED), "A bank offers loans to customers.").unwrap();
        let unrelated = infer_at(&base.join(EMBED), "Cats sleep under a sunny tree.").unwrap();
        let similarity = |v: &[f32]| q.iter().zip(v).map(|(a,b)| a*b).sum::<f32>();
        assert!(similarity(&relevant) > similarity(&unrelated));
        let long = format!("{} A bank offers loans.", "A river flows through the forest. ".repeat(100));
        embedding_model::validate_vector(&infer_at(&base.join(EMBED), &long).unwrap()).unwrap();
        let scores = rerank_at(&base.join(RERANK), "Where can I borrow money?", &["Cats sleep under a sunny tree.", "A bank offers loans to customers."]).unwrap();
        assert_eq!(scores.len(), 2); assert!(scores[1] > scores[0]);
        assert_ne!(signature(EMBED).unwrap(), embedding_model::signature());
        eprintln!("local-model-evidence {}", json!({"embedding":metadata(EMBED).unwrap(),"reranker":metadata(RERANK).unwrap(),"relevantCosine":similarity(&relevant),"unrelatedCosine":similarity(&unrelated),"rerankScores":scores,"elapsedMs":started.elapsed().as_millis(),"externalApi":false}));
    }
}
