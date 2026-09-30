//! Locked, local-only E5 inference. No Hub client or caller-selected model path.
use super::*;
use fastembed::{
    InitOptionsUserDefined, Pooling, QuantizationMode, TextEmbedding, TokenizerFiles,
    UserDefinedEmbeddingModel,
};
use serde_json::{json, Value};
use std::{
    collections::VecDeque,
    fs,
    io::Read,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
    time::Duration,
};
pub const MODEL_ID: &str = "multilingual-e5-small-int8-v1";
pub const DIM: usize = 384;
pub const MODEL_SHA: &str = "f80102d3f2a1229f387d3c81909990d8945513e347b0eab049f7de3c6f98c193";
pub const MODEL_REV: &str = "761b726dd34fb83930e26aab4e9ac3899aa1fa78";
pub const WINDOW_POLICY: &str = "token-offset-500-weighted-mean-l2-v1";
const ASSETS: [(&str, usize, &str); 5] = [
    ("model_quantized.onnx", 118308185, MODEL_SHA),
    (
        "tokenizer.json",
        17082730,
        "0b44a9d7b51c3c62626640cda0e2c2f70fdacdc25bbbd68038369d14ebdf4c39",
    ),
    (
        "config.json",
        658,
        "cb99455288675345e1a4f411438d5d0adbba5fbd3a67ea4fb03c015433b996c1",
    ),
    (
        "special_tokens_map.json",
        167,
        "d05497f1da52c5e09554c0cd874037a083e1dc1b9cfd48034d1c717f1afc07a7",
    ),
    (
        "tokenizer_config.json",
        443,
        "a1d6bc8734a6f635dc158508bef000f8e2e5a759c7d92f984b2c86e5ff53425b",
    ),
];
struct Loaded {
    root: PathBuf,
    model: TextEmbedding,
    window_tokenizer: tokenizers::Tokenizer,
    queries: VecDeque<(String, Vec<f32>)>,
}
static MODEL: OnceLock<Mutex<Option<Loaded>>> = OnceLock::new();
pub fn validate_id(id: &str) -> Result<(), String> {
    if id != MODEL_ID {
        Err("BLK-EMBED-MODEL".into())
    } else {
        Ok(())
    }
}
pub fn signature() -> String {
    digest(
        format!(
            "{MODEL_ID}:{}:{DIM}:mean:l2:microbatch1:{WINDOW_POLICY}:query:passage",
            ASSETS.map(|(_, _, hash)| hash).join(":")
        )
        .as_bytes(),
    )
}
fn root() -> Result<PathBuf, String> {
    let path = if let Some(path) = std::env::var_os("BLOCKY_MODEL_DIR") {
        PathBuf::from(path)
    } else {
        let executable = std::env::current_exe().map_err(|_| IO)?;
        let directory = executable.parent().ok_or(IO)?;
        let adjacent = directory.join("models").join("multilingual-e5-small");
        // The packaged native CLI lives exactly at <product>/cli/bin/. Only
        // this fixed alternate layout is admitted; never search ancestors.
        let product = directory
            .parent()
            .and_then(Path::parent)
            .map(|root| root.join("models").join("multilingual-e5-small"));
        if adjacent.exists() {
            adjacent
        } else {
            product
                .filter(|candidate| candidate.exists())
                .unwrap_or(adjacent)
        }
    };
    if !path.exists() {
        return Err("BLK-EMBED-MISSING".into());
    }
    ingest::no_links(&path)?;
    path.canonicalize().map_err(|_| IO.into())
}
fn asset(root: &Path, name: &str, size: usize, sha: &str) -> Result<Vec<u8>, String> {
    cancel::check()?;
    let path = root.join(name);
    if !path.exists() {
        return Err("BLK-EMBED-MISSING".into());
    }
    ingest::no_links(&path)?;
    let file = fs::File::open(&path).map_err(|_| "BLK-EMBED-MISSING")?;
    if file.metadata().map_err(|_| IO)?.len() != size as u64 {
        return Err("BLK-EMBED-MODEL-CORRUPT".into());
    }
    let mut bytes = Vec::with_capacity(size);
    file.take(size as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| IO)?;
    if bytes.len() != size || digest(&bytes) != sha {
        return Err("BLK-EMBED-MODEL-CORRUPT".into());
    }
    cancel::check()?;
    Ok(bytes)
}
pub fn verify_directory(root: &Path) -> Result<(), String> {
    for (name, size, sha) in ASSETS {
        asset(root, name, size, sha)?;
    }
    Ok(())
}
pub fn metadata() -> Value {
    json!({"modelId":MODEL_ID,"dimension":DIM,"modelRevision":MODEL_REV,"modelSha256":MODEL_SHA,"backend":"onnx-cpu","externalApi":false,"windowPolicy":WINDOW_POLICY,"maxTokens":512,"microbatchSize":1,"intraThreads":4,"signature":signature()})
}
pub fn status(id: &str) -> Result<Value, String> {
    validate_id(id)?;
    let mut result = metadata();
    match root() {
        Err(error) if error == "BLK-EMBED-MISSING" => {
            result["available"] = false.into();
            result["verified"] = false.into();
            result["loaded"] = false.into();
        }
        Err(error) => return Err(error),
        Ok(path) => {
            let available = ASSETS.iter().all(|(name, _, _)| path.join(name).is_file());
            result["available"] = available.into();
            let verified = verify_directory(&path);
            result["verified"] = verified.is_ok().into();
            if let Err(code) = verified {
                result["code"] = code.into();
            }
            result["loaded"] = MODEL
                .get()
                .and_then(|v| v.try_lock().ok())
                .is_some_and(|v| v.as_ref().is_some_and(|v| v.root == path))
                .into();
        }
    }
    Ok(result)
}
fn load(root: &Path) -> Result<Loaded, String> {
    tokenizers::utils::parallelism::set_parallelism(false);
    let mut files = ASSETS
        .iter()
        .map(|(name, size, sha)| asset(root, name, *size, sha))
        .collect::<Result<Vec<_>, _>>()?
        .into_iter();
    let onnx = files.next().ok_or(INVALID)?;
    let tokenizer = TokenizerFiles {
        tokenizer_file: files.next().ok_or(INVALID)?,
        config_file: files.next().ok_or(INVALID)?,
        special_tokens_map_file: files.next().ok_or(INVALID)?,
        tokenizer_config_file: files.next().ok_or(INVALID)?,
    };
    let definition = UserDefinedEmbeddingModel::new(onnx, tokenizer)
        .with_pooling(Pooling::Mean)
        .with_quantization(QuantizationMode::Dynamic);
    let model = TextEmbedding::try_new_from_user_defined(
        definition,
        InitOptionsUserDefined::new()
            .with_max_length(512)
            .with_intra_threads(4),
    )
    .map_err(|_| "BLK-EMBED-INIT")?;
    let mut window_tokenizer = model.tokenizer.clone();
    window_tokenizer
        .with_truncation(None)
        .map_err(|_| "BLK-EMBED-TOKENIZE")?;
    window_tokenizer.with_padding(None);
    cancel::check()?;
    Ok(Loaded {
        root: root.to_path_buf(),
        model,
        window_tokenizer,
        queries: VecDeque::new(),
    })
}
fn with_model<T>(f: impl FnOnce(&mut Loaded) -> Result<T, String>) -> Result<T, String> {
    let path = root()?;
    let mutex = MODEL.get_or_init(|| Mutex::new(None));
    let mut guard = loop {
        cancel::check()?;
        match mutex.try_lock() {
            Ok(guard) => break guard,
            Err(std::sync::TryLockError::Poisoned(_)) => return Err("BLK-EMBED-INIT".into()),
            Err(_) => std::thread::sleep(Duration::from_millis(10)),
        }
    };
    if !guard.as_ref().is_some_and(|v| v.root == path) {
        *guard = Some(load(&path)?);
    }
    f(guard.as_mut().ok_or("BLK-EMBED-INIT")?)
}
pub fn install(id: &str) -> Result<Value, String> {
    validate_id(id)?;
    with_model(|_| Ok(()))?;
    let mut value = metadata();
    value["available"] = true.into();
    value["verified"] = true.into();
    value["loaded"] = true.into();
    Ok(value)
}
fn windows(
    tokenizer: &tokenizers::Tokenizer,
    text: &str,
    prefix: &str,
) -> Result<Vec<(String, usize)>, String> {
    super::model_windows::windows(tokenizer, text, Some(prefix), 500, 512)
}

pub fn infer(text: &str, query: bool) -> Result<Vec<f32>, String> {
    if text.trim().is_empty() || text.len() > 65536 {
        return Err(INVALID.into());
    }
    let key = digest(text.as_bytes());
    with_model(|loaded| {
        if query {
            if let Some((_, vector)) = loaded.queries.iter().find(|(id, _)| *id == key) {
                return Ok(vector.clone());
            }
        }
        let parts = windows(
            &loaded.window_tokenizer,
            text,
            if query { "query" } else { "passage" },
        )?;
        let mut mean = vec![0f32; DIM];
        for (text, weight) in parts {
            cancel::check()?;
            let vectors = loaded
                .model
                .embed([text], Some(1))
                .map_err(|_| "BLK-EMBED-INFERENCE")?;
            let vector = vectors.first().ok_or("BLK-EMBED-INFERENCE")?;
            validate_vector(vector)?;
            for (sum, value) in mean.iter_mut().zip(vector) {
                *sum += value * weight as f32;
            }
        }
        let norm = mean.iter().map(|v| (*v as f64).powi(2)).sum::<f64>().sqrt();
        if !norm.is_finite() || norm < 1e-12 {
            return Err("BLK-EMBED-INFERENCE".into());
        }
        for value in &mut mean {
            *value /= norm as f32;
        }
        validate_vector(&mean)?;
        cancel::check()?;
        if query {
            loaded.queries.push_back((key, mean.clone()));
            while loaded.queries.len() > 128 {
                loaded.queries.pop_front();
            }
        }
        Ok(mean)
    })
}
pub fn validate_vector(vector: &[f32]) -> Result<(), String> {
    if vector.len() != DIM || vector.iter().any(|v| !v.is_finite()) {
        return Err("BLK-EMBED-DIMENSION".into());
    }
    let norm = vector.iter().map(|v| (*v as f64).powi(2)).sum::<f64>();
    if (norm - 1.).abs() > 0.01 {
        return Err("BLK-EMBED-VECTOR".into());
    }
    Ok(())
}
#[cfg(test)]
pub fn window_count(text: &str) -> Result<usize, String> {
    with_model(|loaded| Ok(windows(&loaded.window_tokenizer, text, "passage")?.len()))
}
