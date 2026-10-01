//! Atomic profile/project evaluation assets. Caller holds the AgentData grant and
//! cancellation lock through `manage`. Keys are opaque JSON strings, never paths.
//! Host independently enforces strict evaluation metadata schemas before preflight
//! and persistence. Explicit structured detail follows the redaction boundary.
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
};
const INVALID: &str = "BLK-EVAL-HOST-REQUEST";
const CORRUPT: &str = "BLK-EVAL-HOST-CORRUPT";
const CONFLICT: &str = "BLK-EVAL-ASSET-CONFLICT";
const IMMUTABLE: &str = "BLK-EVAL-ASSET-IMMUTABLE";
const IO: &str = "BLK-EVAL-HOST-IO";
const LIMIT: &str = "BLK-EVAL-HOST-LIMIT";
const PERMISSION: &str = "BLK-PERM-001";
const MAX_ASSET: usize = 8 * 1024 * 1024;
const MAX_STORE: usize = 64 * 1024 * 1024;
const MAX_ENTRIES: usize = 512;
const MAX_REVISION: u64 = 9_007_199_254_740_991;
fn sha(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn id(v: &str) -> bool {
    !v.is_empty()
        && v.len() <= 128
        && v.as_bytes()[0].is_ascii_lowercase()
        && v.split(['.', '_', '-']).all(|p| {
            !p.is_empty()
                && p.bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
        })
}
fn key(v: &str) -> bool {
    !v.is_empty()
        && v.encode_utf16().count() <= 256
        && !v.chars().any(|c| c <= '\u{1f}' || c == '\u{7f}')
}
fn kind(v: &str) -> bool {
    ["dataset", "report", "checkpoint"].contains(&v)
}
fn hash(v: &Value) -> bool {
    v.as_str().is_some_and(|s| {
        s.len() == 64
            && s.bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    })
}
fn stamp(v: &Value) -> bool {
    v.as_u64().is_some_and(|n| n <= MAX_REVISION)
}
fn identity(v: &Value) -> bool {
    v.as_str().is_some_and(id)
}
fn text(v: &Value, limit: usize) -> bool {
    v.as_str()
        .is_some_and(|s| !s.is_empty() && s.encode_utf16().count() <= limit)
}
fn present_revision<'de, D: serde::Deserializer<'de>>(
    d: D,
) -> Result<Option<Option<u64>>, D::Error> {
    Option::<u64>::deserialize(d).map(Some)
}
fn present_value<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Option<Value>, D::Error> {
    Value::deserialize(d).map(Some)
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Request {
    pub schema_version: String,
    pub request_id: String,
    pub project_id: String,
    pub session_id: String,
    pub action: String,
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub key: Option<String>,
    #[serde(
        default,
        deserialize_with = "present_revision",
        skip_serializing_if = "Option::is_none"
    )]
    pub expected_revision: Option<Option<u64>>,
    #[serde(
        default,
        deserialize_with = "present_value",
        skip_serializing_if = "Option::is_none"
    )]
    pub value: Option<Value>,
}
impl Request {
    pub fn validate(&self) -> Result<(), String> {
        let cas = self.action == "cas";
        let existing = ["cas", "read"].contains(&self.action.as_str());
        if self.schema_version != "blocky.evaluation-asset-request/v1"
            || !id(&self.request_id)
            || !id(&self.project_id)
            || !id(&self.session_id)
            || !(existing || self.action == "list")
            || !kind(&self.kind)
            || existing != self.key.is_some()
            || self.key.as_deref().is_some_and(|v| !key(v))
            || cas != self.expected_revision.is_some()
            || cas != self.value.is_some()
            || self
                .expected_revision
                .flatten()
                .is_some_and(|n| n > MAX_REVISION)
        {
            return Err(INVALID.into());
        }
        if let Some(value) = &self.value {
            validate_value(&self.kind, value)?;
        }
        Ok(())
    }
    pub fn preflight(&self) -> Result<Value, String> {
        self.validate()?;
        Ok(
            json!({"requestDigest":sha(&serde_json::to_vec(self).map_err(|_|INVALID)?),
        "projectId":self.project_id,"sessionId":self.session_id,"action":self.action,"kind":self.kind,"key":self.key,"expectedRevision":self.expected_revision,
        "valueBytes":self.value.as_ref().map(|v|serde_json::to_vec(v).map(|b|b.len())).transpose().map_err(|_|INVALID)?}),
        )
    }
}
fn exact(v: &Value, required: &[&str], optional: &[&str]) -> bool {
    v.as_object().is_some_and(|o| {
        required.iter().all(|k| o.contains_key(*k))
            && o.keys()
                .all(|k| required.contains(&k.as_str()) || optional.contains(&k.as_str()))
    })
}
fn array(v: &Value, min: usize, max: usize, check: impl Fn(&Value) -> bool) -> bool {
    v.as_array()
        .is_some_and(|a| a.len() >= min && a.len() <= max && a.iter().all(check))
}
fn optional(v: &Value, k: &str, check: impl Fn(&Value) -> bool) -> bool {
    v.get(k).is_none_or(check)
}
fn nullable(v: &Value, check: impl Fn(&Value) -> bool) -> bool {
    v.is_null() || check(v)
}
fn choice(v: &Value, choices: &[&str]) -> bool {
    v.as_str().is_some_and(|s| choices.contains(&s))
}
fn integer(v: &Value) -> bool {
    v.as_u64().is_some_and(|n| n <= MAX_REVISION)
}
fn finite(v: &Value) -> bool {
    v.as_f64().is_some_and(|n| n.is_finite() && n >= 0.0)
}
fn score(v: &Value) -> bool {
    v.as_f64()
        .is_some_and(|n| n.is_finite() && (0.0..=1.0).contains(&n))
}
fn bool_null(v: &Value) -> bool {
    v.is_null() || v.is_boolean()
}
fn code(v: &Value) -> bool {
    v.as_str().is_some_and(|s| {
        s.starts_with("BLK-")
            && (3..=64).contains(&s[4..].len())
            && s[4..]
                .bytes()
                .all(|b| b.is_ascii_uppercase() || b.is_ascii_digit() || b == b'-')
    })
}
fn model(v: &Value) -> bool {
    exact(v, &["resourceId", "provider", "modelId", "version"], &[])
        && identity(&v["resourceId"])
        && text(&v["provider"], 128)
        && text(&v["modelId"], 256)
        && text(&v["version"], 128)
}
fn validate_binding(v: &Value) -> bool {
    exact(v, &["configurationHash", "model"], &[])
        && hash(&v["configurationHash"])
        && model(&v["model"])
}
fn usage(v: &Value) -> bool {
    exact(v, &["inputTokens", "outputTokens", "totalTokens"], &[])
        && ["inputTokens", "outputTokens", "totalTokens"]
            .iter()
            .all(|k| integer(&v[*k]))
}
fn generation(v: &Value) -> bool {
    exact(
        v,
        &["provider", "model", "transport", "requestId", "usage"],
        &[],
    ) && text(&v["provider"], 128)
        && text(&v["model"], 256)
        && choice(&v["transport"], &["local", "remote"])
        && text(&v["requestId"], 256)
        && nullable(&v["usage"], usage)
}
// Mirrors observability's structured redaction boundary. Ordinary business keys
// (including answer/input) remain legal only in explicitly selected structured detail.
fn safe_detail(v: &Value) -> bool {
    static SENSITIVE: std::sync::LazyLock<regex::Regex> = std::sync::LazyLock::new(|| {
        regex::Regex::new(r"(?i)authorization|cookie|password|api[_-]?key|token|secret|^(?:prompt|body|stdout|stderr|environment)$").unwrap()
    });
    static CREDENTIAL: std::sync::LazyLock<regex::Regex> = std::sync::LazyLock::new(|| {
        regex::Regex::new(r"(?i)\bBearer\s+\S+|(?:password|token|api[_-]?key)\s*[=:]\s*[^\s,;]+|<fixture-invalid-[^>]+>").unwrap()
    });
    static PRIVATE_PATH: std::sync::LazyLock<regex::Regex> = std::sync::LazyLock::new(|| {
        regex::Regex::new(r#"(?:^|[^A-Za-z0-9+.-])[A-Za-z]:[\\/][^\s"<>]+"#).unwrap()
    });
    fn visit(v: &Value, depth: usize) -> bool {
        if depth > 30 {
            return false;
        }
        match v {
            Value::Object(o) => {
                o.len() <= 1000
                    && o.iter().all(|(k, v)| {
                        let counter = [
                            "inputTokens",
                            "outputTokens",
                            "totalTokens",
                            "reservedOutputTokens",
                            "maxOutputTokens",
                            "maxOutputTokensPerTurn",
                            "contextTokens",
                        ]
                        .contains(&k.as_str())
                            && v.as_u64().is_some_and(|n| n <= 10_000_000);
                        if !counter && SENSITIVE.is_match(k) {
                            return v == "[已脱敏]";
                        }
                        visit(v, depth + 1)
                    })
            }
            Value::Array(a) => a.len() <= 1000 && a.iter().all(|v| visit(v, depth + 1)),
            Value::String(s) => {
                s.len() <= 16000 && !CREDENTIAL.is_match(s) && !PRIVATE_PATH.is_match(s)
            }
            _ => true,
        }
    }
    visit(v, 0)
}
fn row(v: &Value, structured: bool) -> bool {
    exact(
        v,
        &[
            "caseId",
            "status",
            "passed",
            "checks",
            "answerHash",
            "structuredHash",
            "citationIds",
            "retrievalHitIds",
            "generations",
            "latencyMs",
        ],
        &["structuredResult", "errorCode"],
    ) && identity(&v["caseId"])
        && choice(&v["status"], &["completed", "failed", "uncertain"])
        && bool_null(&v["passed"])
        && exact(
            &v["checks"],
            &["correctness", "citations", "retrieval"],
            &[],
        )
        && ["correctness", "citations", "retrieval"]
            .iter()
            .all(|k| bool_null(&v["checks"][*k]))
        && nullable(&v["answerHash"], hash)
        && nullable(&v["structuredHash"], hash)
        && optional(v, "structuredResult", |r| structured && safe_detail(r))
        && array(&v["citationIds"], 0, 256, identity)
        && array(&v["retrievalHitIds"], 0, 256, identity)
        && array(&v["generations"], 0, 64, generation)
        && nullable(&v["latencyMs"], finite)
        && optional(v, "errorCode", code)
}
fn accuracy(v: &Value) -> bool {
    if !exact(v, &["scored", "passed", "accuracy"], &[])
        || !integer(&v["scored"])
        || !integer(&v["passed"])
    {
        return false;
    }
    let scored = v["scored"].as_u64().unwrap();
    let passed = v["passed"].as_u64().unwrap();
    passed <= scored
        && if scored == 0 {
            v["accuracy"].is_null()
        } else {
            score(&v["accuracy"]) && v["accuracy"].as_f64() == Some(passed as f64 / scored as f64)
        }
}
fn metrics(v: &Value) -> bool {
    if !exact(
        v,
        &[
            "cases",
            "correctness",
            "citations",
            "retrieval",
            "averageLatencyMs",
            "usage",
        ],
        &[],
    ) || !exact(
        &v["cases"],
        &["total", "completed", "failed", "uncertain"],
        &[],
    ) || !["total", "completed", "failed", "uncertain"]
        .iter()
        .all(|k| integer(&v["cases"][*k]))
        || !["correctness", "citations", "retrieval"]
            .iter()
            .all(|k| accuracy(&v[*k]))
        || !nullable(&v["averageLatencyMs"], finite)
        || !exact(
            &v["usage"],
            &["status", "inputTokens", "outputTokens", "totalTokens"],
            &[],
        )
    {
        return false;
    }
    let c = &v["cases"];
    if c["completed"].as_u64().unwrap()
        + c["failed"].as_u64().unwrap()
        + c["uncertain"].as_u64().unwrap()
        > c["total"].as_u64().unwrap()
    {
        return false;
    }
    let u = &v["usage"];
    if u["status"] == "reported" {
        usage(
            &json!({"inputTokens":u["inputTokens"],"outputTokens":u["outputTokens"],"totalTokens":u["totalTokens"]}),
        ) && u["totalTokens"].as_u64()
            == u["inputTokens"]
                .as_u64()
                .zip(u["outputTokens"].as_u64())
                .map(|(a, b)| a + b)
    } else {
        choice(&u["status"], &["unavailable", "not-reported"])
            && ["inputTokens", "outputTokens", "totalTokens"]
                .iter()
                .all(|k| u[*k].is_null())
    }
}
fn model_score(v: &Value) -> bool {
    exact(v, &["caseId"], &["score", "errorCode", "generation"])
        && identity(&v["caseId"])
        && (v.get("score").is_some() != v.get("errorCode").is_some())
        && optional(v, "score", score)
        && optional(v, "errorCode", code)
        && optional(v, "generation", generation)
}
fn model_scoring(v: &Value) -> bool {
    exact(v, &["status", "rows"], &["binding"])
        && choice(&v["status"], &["not-run", "completed", "partial", "failed"])
        && optional(v, "binding", model)
        && array(&v["rows"], 0, 10000, model_score)
}
fn human(v: &Value) -> bool {
    exact(v, &["caseId", "score", "ratedAt"], &["reviewerId"])
        && identity(&v["caseId"])
        && score(&v["score"])
        && stamp(&v["ratedAt"])
        && optional(v, "reviewerId", identity)
}
fn unique(v: &Value) -> bool {
    let mut ids = std::collections::HashSet::new();
    v.as_array()
        .is_some_and(|a| a.iter().all(|r| ids.insert(r["caseId"].as_str())))
}
fn dataset_case(v: &Value) -> bool {
    exact(v, &["caseId", "input"], &["expected", "tags"])
        && identity(&v["caseId"])
        && optional(v, "tags", |v| array(v, 0, 32, |v| text(v, 64)))
        && optional(v, "expected", |e| {
            exact(
                e,
                &[],
                &["answer", "structured", "citationIds", "retrievalHitIds"],
            ) && e.as_object().is_some_and(|o| !o.is_empty())
                && optional(e, "answer", |v| {
                    v.as_str()
                        .is_some_and(|s| s.encode_utf16().count() <= 65536)
                })
                && optional(e, "citationIds", |v| array(v, 0, 256, identity))
                && optional(e, "retrievalHitIds", |v| array(v, 0, 256, identity))
        })
}
fn validate_value(asset_kind: &str, v: &Value) -> Result<(), String> {
    if serde_json::to_vec(v).map_err(|_| INVALID)?.len() > MAX_ASSET {
        return Err(LIMIT.into());
    }
    if v["schemaVersion"] != format!("blocky.evaluation-{asset_kind}/v1")
        || !validate_binding(&v["binding"])
        || !stamp(&v["createdAt"])
    {
        return Err(INVALID.into());
    }
    if asset_kind == "dataset" {
        if !exact(
            v,
            &[
                "schemaVersion",
                "datasetId",
                "version",
                "name",
                "createdAt",
                "status",
                "binding",
                "cases",
            ],
            &["frozenAt", "contentHash", "bindingHash"],
        ) || !identity(&v["datasetId"])
            || !v["version"]
                .as_u64()
                .is_some_and(|n| (1..=65535).contains(&n))
            || !v["name"]
                .as_str()
                .is_some_and(|s| !s.trim().is_empty() && s.trim().encode_utf16().count() <= 128)
            || !array(&v["cases"], 1, 10000, dataset_case)
            || !unique(&v["cases"])
        {
            return Err(INVALID.into());
        }
        let frozen = v["status"] == "frozen";
        if !(frozen && hash(&v["contentHash"]) && hash(&v["bindingHash"]) && stamp(&v["frozenAt"])
            || v["status"] == "draft"
                && ["contentHash", "bindingHash", "frozenAt"]
                    .iter()
                    .all(|k| v.get(*k).is_none()))
        {
            return Err(INVALID.into());
        }
        return Ok(());
    }
    let common = &[
        "schemaVersion",
        "reportId",
        "checkpointId",
        "datasetId",
        "datasetVersion",
        "datasetContentHash",
        "binding",
        "candidate",
        "resultDetailPolicy",
        "status",
        "createdAt",
        "updatedAt",
    ][..];
    let mut required = common.to_vec();
    required.extend(if asset_kind == "report" {
        vec!["rows", "metrics", "scoring"]
    } else {
        vec!["cases", "modelScoring"]
    });
    if !["report", "checkpoint"].contains(&asset_kind)
        || !exact(
            v,
            &required,
            if asset_kind == "report" {
                &["completedAt"]
            } else {
                &[]
            },
        )
        || !["reportId", "checkpointId", "datasetId"]
            .iter()
            .all(|k| identity(&v[*k]))
        || !v["datasetVersion"]
            .as_u64()
            .is_some_and(|n| (1..=65535).contains(&n))
        || !hash(&v["datasetContentHash"])
        || !exact(&v["candidate"], &["id", "version", "contentHash"], &[])
        || !identity(&v["candidate"]["id"])
        || !text(&v["candidate"]["version"], 128)
        || !hash(&v["candidate"]["contentHash"])
        || !choice(&v["resultDetailPolicy"], &["summary", "structured"])
        || !stamp(&v["updatedAt"])
    {
        return Err(INVALID.into());
    }
    let structured = v["resultDetailPolicy"] == "structured";
    if asset_kind == "report" {
        if !array(&v["rows"], 0, 10000, |r| row(r, structured))
            || !unique(&v["rows"])
            || !metrics(&v["metrics"])
            || !exact(&v["scoring"], &["deterministic", "model", "human"], &[])
            || !metrics(&v["scoring"]["deterministic"])
            || !model_scoring(&v["scoring"]["model"])
            || !array(&v["scoring"]["human"], 0, 10000, human)
        {
            return Err(INVALID.into());
        }
        let rows = v["rows"].as_array().unwrap();
        let c = &v["metrics"]["cases"];
        if ["completed", "failed", "uncertain"].iter().any(|k| {
            c[*k].as_u64() != Some(rows.iter().filter(|r| r["status"] == *k).count() as u64)
        }) || c["total"].as_u64().unwrap() < rows.len() as u64
        {
            return Err(INVALID.into());
        }
        if !(v["status"] == "partial" && v.get("completedAt").is_none()
            || v["status"] == "completed"
                && stamp(&v["completedAt"])
                && v["completedAt"].as_u64() >= v["createdAt"].as_u64()
                && rows.len() as u64 == c["total"].as_u64().unwrap())
        {
            return Err(INVALID.into());
        }
    } else {
        if !choice(&v["status"], &["running", "cancelled", "completed"])
            || !model_scoring(&v["modelScoring"])
            || !array(&v["cases"], 1, 10000, |c| {
                exact(c, &["caseId", "status"], &["result"])
                    && identity(&c["caseId"])
                    && choice(
                        &c["status"],
                        &["pending", "started", "settled", "uncertain"],
                    )
                    && (choice(&c["status"], &["settled", "uncertain"])
                        == c.get("result").is_some())
                    && optional(c, "result", |r| {
                        row(r, structured) && r["caseId"] == c["caseId"]
                    })
            })
            || !unique(&v["cases"])
            || v["status"] == "completed"
                && v["cases"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|c| choice(&c["status"], &["pending", "started"]))
        {
            return Err(INVALID.into());
        }
    }
    Ok(())
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Asset {
    kind: String,
    key: String,
    revision: u64,
    value: Value,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Store {
    schema_version: String,
    assets: BTreeMap<String, Asset>,
}
fn regular(path: &Path) -> Result<(), String> {
    crate::knowledge::no_links(path).map_err(|_| PERMISSION.to_owned())
}
fn file_options() -> fs::OpenOptions {
    let mut options = fs::OpenOptions::new();
    options.read(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        options.custom_flags(windows_sys::Win32::Storage::FileSystem::FILE_FLAG_OPEN_REPARSE_POINT);
    }
    options
}
fn checked_file(file: &fs::File) -> Result<(), String> {
    let metadata = file.metadata().map_err(|_| IO)?;
    if !metadata.is_file() {
        return Err(PERMISSION.into());
    }
    #[cfg(windows)]
    {
        use std::os::windows::{fs::MetadataExt, io::AsRawHandle};
        let mut info =
            windows_sys::Win32::Storage::FileSystem::BY_HANDLE_FILE_INFORMATION::default();
        if metadata.file_attributes() & 0x400 != 0
            || unsafe {
                windows_sys::Win32::Storage::FileSystem::GetFileInformationByHandle(
                    file.as_raw_handle() as _,
                    &mut info,
                )
            } == 0
            || info.nNumberOfLinks != 1
        {
            return Err(PERMISSION.into());
        }
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if metadata.nlink() != 1 {
            return Err(PERMISSION.into());
        }
    }
    Ok(())
}
fn scope(root: &Path, project: &str) -> Result<PathBuf, String> {
    if !root.is_absolute()
        || root
            .components()
            .any(|c| matches!(c, std::path::Component::ParentDir))
        || !id(project)
    {
        return Err(INVALID.into());
    }
    if let Some(existing) = root.ancestors().find(|p| p.exists()) {
        regular(existing)?;
    }
    let path = root.join(sha(project.as_bytes()));
    fs::create_dir_all(&path).map_err(|_| IO)?;
    regular(&path)?;
    Ok(path)
}
fn asset_key(asset_kind: &str, key: &str) -> String {
    sha(&serde_json::to_vec(&(asset_kind, key)).unwrap())
}
fn load(path: &Path) -> Result<Store, String> {
    let file = match file_options().open(path) {
        Ok(f) => f,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Ok(Store {
                schema_version: "blocky.evaluation-store/v1".into(),
                assets: BTreeMap::new(),
            });
        }
        Err(_) => return Err(IO.into()),
    };
    regular(path)?;
    checked_file(&file)?;
    if file.metadata().map_err(|_| IO)?.len() > MAX_STORE as u64 {
        return Err(LIMIT.into());
    }
    let mut bytes = Vec::new();
    file.take(MAX_STORE as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| IO)?;
    if bytes.len() > MAX_STORE {
        return Err(LIMIT.into());
    }
    let parsed = crate::strict_json::parse(&bytes).map_err(|_| CORRUPT)?;
    let store: Store = serde_json::from_value(parsed).map_err(|_| CORRUPT)?;
    if store.schema_version != "blocky.evaluation-store/v1" || store.assets.len() > MAX_ENTRIES {
        return Err(CORRUPT.into());
    }
    for (identity, asset) in &store.assets {
        if !kind(&asset.kind)
            || !key(&asset.key)
            || asset.revision == 0
            || asset.revision > MAX_REVISION
            || identity != &asset_key(&asset.kind, &asset.key)
            || validate_value(&asset.kind, &asset.value).is_err()
        {
            return Err(CORRUPT.into());
        }
    }
    Ok(store)
}
fn save(path: &Path, store: &Store) -> Result<(), String> {
    let bytes = serde_json::to_vec(store).map_err(|_| INVALID)?;
    if bytes.len() > MAX_STORE {
        return Err(LIMIT.into());
    }
    if path.exists() {
        regular(path)?;
        checked_file(&file_options().open(path).map_err(|_| IO)?)?;
    }
    let parent = path.parent().ok_or(IO)?;
    regular(parent)?;
    let mut temporary = tempfile::NamedTempFile::new_in(parent).map_err(|_| IO)?;
    temporary
        .write_all(&bytes)
        .and_then(|_| temporary.as_file().sync_all())
        .map_err(|_| IO)?;
    // Atomic same-directory replace. The previous ledger survives a write/rename error.
    temporary.persist(path).map_err(|_| IO)?;
    Ok(())
}
pub fn manage(root: &Path, request: &Request) -> Result<Value, String> {
    request.validate()?;
    let path = scope(root, &request.project_id)?;
    let lock_path = path.join("assets.lock");
    if lock_path.exists() {
        regular(&lock_path)?;
    }
    let mut options = file_options();
    options.write(true).create(true).truncate(false);
    let lock = options.open(&lock_path).map_err(|_| IO)?;
    checked_file(&lock)?;
    regular(&lock_path)?;
    lock.try_lock().map_err(|_| "BLK-EVAL-HOST-BUSY")?;
    let file = path.join("assets.json");
    let mut store = load(&file)?;
    if request.action == "list" {
        return Ok(
            json!({"assets":store.assets.values().filter(|a|a.kind==request.kind).map(|a|json!({"kind":a.kind,"key":a.key,"revision":a.revision})).collect::<Vec<_>>()}),
        );
    }
    let key = request.key.as_ref().ok_or(INVALID)?;
    let identity = asset_key(&request.kind, key);
    let current = store.assets.get(&identity);
    if request.action == "read" {
        return current
            .map(|a| serde_json::to_value(a).map_err(|_| IO.into()))
            .unwrap_or(Ok(Value::Null));
    }
    if current.map(|a| a.revision) != request.expected_revision.ok_or(INVALID)? {
        return Err(CONFLICT.into());
    }
    if current.is_some_and(|a| {
        (a.kind == "dataset" && a.value["status"] == "frozen")
            || (a.kind == "report" && a.value["status"] == "completed")
    }) {
        return Err(IMMUTABLE.into());
    }
    if current.is_none() && store.assets.len() >= MAX_ENTRIES {
        return Err(LIMIT.into());
    }
    let revision = current
        .map_or(0, |a| a.revision)
        .checked_add(1)
        .filter(|n| *n <= MAX_REVISION)
        .ok_or(CONFLICT)?;
    let asset = Asset {
        kind: request.kind.clone(),
        key: key.clone(),
        revision,
        value: request.value.clone().ok_or(INVALID)?,
    };
    let result = serde_json::to_value(&asset).map_err(|_| INVALID)?;
    store.assets.insert(identity, asset);
    save(&file, &store)?;
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> tempfile::TempDir {
        tempfile::tempdir_in(
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("../../try")
                .canonicalize()
                .unwrap(),
        )
        .unwrap()
    }
    fn binding() -> Value {
        json!({"configurationHash":"0".repeat(64),"model":{"resourceId":"model-one","provider":"local","modelId":"test","version":"one"}})
    }
    fn value(asset_kind: &str) -> Value {
        if asset_kind == "dataset" {
            return json!({"schemaVersion":"blocky.evaluation-dataset/v1","datasetId":"dataset-one","version":1,"name":"public dataset","createdAt":1,"status":"draft","binding":binding(),"cases":[{"caseId":"case-one","input":{"public":"example"}}]});
        }
        let mut v = json!({"schemaVersion":format!("blocky.evaluation-{asset_kind}/v1"),"checkpointId":"checkpoint-one","reportId":"report-one","datasetId":"dataset-one","datasetVersion":1,"datasetContentHash":"0".repeat(64),"binding":binding(),"candidate":{"id":"candidate-one","version":"one","contentHash":"0".repeat(64)},"resultDetailPolicy":"summary","createdAt":1,"updatedAt":1});
        if asset_kind == "report" {
            v["status"] = json!("partial");
            v["rows"] = json!([]);
            v["metrics"] = metrics_fixture(0, 0);
            v["scoring"] = json!({"deterministic":v["metrics"],"model":{"status":"not-run","rows":[]},"human":[]});
        } else {
            v["status"] = json!("running");
            v["cases"] = json!([{"caseId":"case-one","status":"pending"}]);
            v["modelScoring"] = json!({"status":"not-run","rows":[]});
        }
        v
    }
    fn metrics_fixture(total: u64, completed: u64) -> Value {
        let accuracy = json!({"scored":0,"passed":0,"accuracy":null});
        json!({"cases":{"total":total,"completed":completed,"failed":0,"uncertain":0},"correctness":accuracy,"citations":accuracy,"retrieval":accuracy,"averageLatencyMs":null,"usage":{"status":"not-reported","inputTokens":null,"outputTokens":null,"totalTokens":null}})
    }
    fn row_fixture() -> Value {
        json!({"caseId":"case-one","status":"completed","passed":true,"checks":{"correctness":true,"citations":null,"retrieval":null},"answerHash":"a".repeat(64),"structuredHash":null,"citationIds":[],"retrievalHitIds":[],"generations":[{"provider":"local","model":"model-one","transport":"local","requestId":"opaque/Provider:request-id","usage":{"inputTokens":1,"outputTokens":2,"totalTokens":3}}],"latencyMs":1})
    }
    fn populated(kind: &str) -> Value {
        let mut v = value(kind);
        let scoring = json!({"status":"completed","binding":binding()["model"],"rows":[{"caseId":"case-one","score":0.5,"generation":row_fixture()["generations"][0]}]});
        if kind == "report" {
            v["rows"] = json!([row_fixture()]);
            v["metrics"] = metrics_fixture(2, 1);
            v["scoring"] = json!({"deterministic":v["metrics"],"model":scoring,"human":[{"caseId":"case-one","score":0.8,"reviewerId":"reviewer-one","ratedAt":1}]});
        } else {
            v["cases"] = json!([{"caseId":"case-one","status":"settled","result":row_fixture()}]);
            v["modelScoring"] = scoring;
        }
        v
    }
    fn request(asset_kind: &str, key: &str, expected: Option<u64>) -> Request {
        serde_json::from_value(json!({"schemaVersion":"blocky.evaluation-asset-request/v1","requestId":"request-one","projectId":"project-one","sessionId":"run-one","action":"cas","kind":asset_kind,"key":key,"expectedRevision":expected,"value":value(asset_kind)})).unwrap()
    }
    fn read(mut r: Request) -> Request {
        r.action = "read".into();
        r.expected_revision = None;
        r.value = None;
        r
    }
    #[test]
    fn cas_reload_opaque_key_and_project_scope() {
        let temp = fixture();
        let root = temp.path().join("evaluation");
        let r = request("dataset", "../opaque/键:two", None);
        let one = manage(&root, &r).unwrap();
        assert_eq!(one["revision"], 1);
        assert_eq!(manage(&root, &read(r.clone())).unwrap(), one);
        let mut next = r.clone();
        next.expected_revision = Some(Some(1));
        assert_eq!(manage(&root, &next).unwrap()["revision"], 2);
        assert_eq!(manage(&root, &r).unwrap_err(), CONFLICT);
        let mut other = read(r);
        other.project_id = "other-project".into();
        assert!(manage(&root, &other).unwrap().is_null());
    }
    #[test]
    fn frozen_and_completed_are_immutable_checkpoint_is_mutable() {
        let temp = fixture();
        for asset_kind in ["dataset", "report", "checkpoint"] {
            let mut r = request(asset_kind, "one", None);
            if asset_kind == "dataset" {
                let v = r.value.as_mut().unwrap();
                v["status"] = json!("frozen");
                v["frozenAt"] = json!(1);
                v["contentHash"] = json!("0".repeat(64));
                v["bindingHash"] = json!("0".repeat(64));
            } else if asset_kind == "report" {
                let v = r.value.as_mut().unwrap();
                v["status"] = json!("completed");
                v["completedAt"] = json!(1);
            }
            manage(temp.path(), &r).unwrap();
            r.expected_revision = Some(Some(1));
            if asset_kind == "checkpoint" {
                assert_eq!(manage(temp.path(), &r).unwrap()["revision"], 2);
            } else {
                assert_eq!(manage(temp.path(), &r).unwrap_err(), IMMUTABLE);
            }
        }
    }
    #[test]
    fn list_only_metadata_and_invalid_schema_size_are_rejected() {
        let temp = fixture();
        let r = request("dataset", "opaque", None);
        manage(temp.path(), &r).unwrap();
        let mut list = read(r.clone());
        list.action = "list".into();
        list.key = None;
        let output = manage(temp.path(), &list).unwrap();
        assert_eq!(
            output,
            json!({"assets":[{"kind":"dataset","key":"opaque","revision":1}]})
        );
        let mut bad = r.clone();
        bad.value.as_mut().unwrap()["schemaVersion"] = json!("blocky.evaluation-report/v1");
        assert_eq!(bad.validate().unwrap_err(), INVALID);
        bad = r.clone();
        bad.value.as_mut().unwrap()["cases"][0]["input"] = json!("x".repeat(MAX_ASSET));
        assert_eq!(bad.validate().unwrap_err(), LIMIT);
        bad = r;
        bad.expected_revision = None;
        assert_eq!(bad.validate().unwrap_err(), INVALID);
    }
    #[test]
    fn corrupt_ledger_and_hardlink_fail_closed() {
        let temp = fixture();
        let r = request("dataset", "one", None);
        manage(temp.path(), &r).unwrap();
        let file = scope(temp.path(), "project-one")
            .unwrap()
            .join("assets.json");
        let previous = fs::read(&file).unwrap();
        fs::write(&file, b"broken ledger").unwrap();
        assert_eq!(manage(temp.path(), &read(r.clone())).unwrap_err(), CORRUPT);
        assert_eq!(fs::read(&file).unwrap(), b"broken ledger");
        fs::write(&file, &previous).unwrap();
        let linked = temp.path().join("linked.json");
        fs::hard_link(&file, &linked).unwrap();
        assert_eq!(manage(temp.path(), &read(r)).unwrap_err(), PERMISSION);
    }
    #[test]
    fn competing_cas_writers_have_one_winner() {
        let temp = fixture();
        let r = request("checkpoint", "one", None);
        manage(temp.path(), &r).unwrap();
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(3));
        let mut threads = Vec::new();
        for _ in 0..2 {
            let root = temp.path().to_path_buf();
            let mut next = r.clone();
            next.expected_revision = Some(Some(1));
            let barrier = barrier.clone();
            threads.push(std::thread::spawn(move || {
                barrier.wait();
                for _ in 0..200 {
                    match manage(&root, &next) {
                        Err(code) if code == "BLK-EVAL-HOST-BUSY" => {
                            std::thread::sleep(std::time::Duration::from_millis(2));
                        }
                        value => return value,
                    }
                }
                panic!("bounded CAS retry exhausted")
            }));
        }
        barrier.wait();
        let outcomes: Vec<_> = threads.into_iter().map(|t| t.join().unwrap()).collect();
        assert_eq!(outcomes.iter().filter(|v| v.is_ok()).count(), 1);
        assert_eq!(
            outcomes
                .iter()
                .filter(|v| v.as_ref().err().is_some_and(|e| e == CONFLICT))
                .count(),
            1
        );
        assert_eq!(manage(temp.path(), &read(r)).unwrap()["revision"], 2);
    }
    #[cfg(windows)]
    #[test]
    fn failed_atomic_replace_preserves_previous_ledger() {
        use std::os::windows::fs::OpenOptionsExt;
        let temp = fixture();
        let mut r = request("checkpoint", "one", None);
        manage(temp.path(), &r).unwrap();
        let folder = scope(temp.path(), "project-one").unwrap();
        let file = folder.join("assets.json");
        let previous = fs::read(&file).unwrap();
        let held = fs::OpenOptions::new()
            .read(true)
            .share_mode(
                windows_sys::Win32::Storage::FileSystem::FILE_SHARE_READ
                    | windows_sys::Win32::Storage::FileSystem::FILE_SHARE_WRITE,
            )
            .open(&file)
            .unwrap();
        r.expected_revision = Some(Some(1));
        assert_eq!(manage(temp.path(), &r).unwrap_err(), IO);
        assert_eq!(fs::read(&file).unwrap(), previous);
        drop(held);
        assert_eq!(manage(temp.path(), &read(r)).unwrap()["revision"], 1);
        assert_eq!(fs::read_dir(folder).unwrap().count(), 2);
    }
    #[test]
    fn strict_nested_report_and_checkpoint_cannot_persist_canaries_or_unknown_fields() {
        for asset_kind in ["report", "checkpoint"] {
            let temp = fixture();
            let mut valid = request(asset_kind, "valid", None);
            valid.value = Some(populated(asset_kind));
            manage(temp.path(), &valid).unwrap();
            let file = scope(temp.path(), "project-one")
                .unwrap()
                .join("assets.json");
            let before = fs::read(&file).unwrap();
            let paths: Vec<&str> = if asset_kind == "report" {
                vec![
                    "",
                    "/binding",
                    "/binding/model",
                    "/candidate",
                    "/rows/0",
                    "/rows/0/checks",
                    "/rows/0/generations/0",
                    "/rows/0/generations/0/usage",
                    "/metrics",
                    "/metrics/cases",
                    "/metrics/correctness",
                    "/metrics/usage",
                    "/scoring",
                    "/scoring/deterministic",
                    "/scoring/deterministic/cases",
                    "/scoring/deterministic/citations",
                    "/scoring/deterministic/usage",
                    "/scoring/model",
                    "/scoring/model/binding",
                    "/scoring/model/rows/0",
                    "/scoring/model/rows/0/generation",
                    "/scoring/model/rows/0/generation/usage",
                    "/scoring/human/0",
                ]
            } else {
                vec![
                    "",
                    "/binding",
                    "/binding/model",
                    "/candidate",
                    "/cases/0",
                    "/cases/0/result",
                    "/cases/0/result/checks",
                    "/cases/0/result/generations/0",
                    "/cases/0/result/generations/0/usage",
                    "/modelScoring",
                    "/modelScoring/binding",
                    "/modelScoring/rows/0",
                    "/modelScoring/rows/0/generation",
                    "/modelScoring/rows/0/generation/usage",
                ]
            };
            for path in paths {
                for (field, canary) in [
                    ("answer", "SYNTHETIC_PRIVATE_BODY"),
                    ("apiKey", "SYNTHETIC_CREDENTIAL_CANARY"),
                    ("unknown", "unknown"),
                ] {
                    let mut bad = valid.clone();
                    bad.expected_revision = Some(Some(1));
                    bad.value
                        .as_mut()
                        .unwrap()
                        .pointer_mut(path)
                        .unwrap()
                        .as_object_mut()
                        .unwrap()
                        .insert(field.into(), json!(canary));
                    assert_eq!(
                        bad.preflight().unwrap_err(),
                        INVALID,
                        "{asset_kind} {path} {field}"
                    );
                    assert_eq!(manage(temp.path(), &bad).unwrap_err(), INVALID);
                    assert_eq!(fs::read(&file).unwrap(), before);
                    bad.key = Some("rejected-new-asset".into());
                    bad.expected_revision = Some(None);
                    assert_eq!(manage(temp.path(), &bad).unwrap_err(), INVALID);
                    assert!(manage(temp.path(), &read(bad)).unwrap().is_null());
                }
            }
            assert_eq!(manage(temp.path(), &read(valid)).unwrap()["revision"], 1);
        }
    }
    #[test]
    fn legitimate_metadata_states_and_structured_business_json_roundtrip() {
        let temp = fixture();
        for asset_kind in ["report", "checkpoint"] {
            let mut r = request(asset_kind, asset_kind, None);
            let mut v = populated(asset_kind);
            if asset_kind == "report" {
                v["status"] = json!("completed");
                v["completedAt"] = json!(1);
                v["metrics"]["cases"]["total"] = json!(1);
            } else {
                v["status"] = json!("completed");
            }
            v["resultDetailPolicy"] = json!("structured");
            let row = if asset_kind == "report" {
                &mut v["rows"][0]
            } else {
                &mut v["cases"][0]["result"]
            };
            row["structuredResult"] = json!({"answer":"business answer","input":{"value":5},"apiKey":"[已脱敏]","inputTokens":5});
            r.value = Some(v.clone());
            r.preflight().unwrap();
            let result = manage(temp.path(), &r).unwrap();
            assert_eq!(result["value"], v);
            assert_eq!(manage(temp.path(), &read(r)).unwrap(), result);
        }
        let mut dataset = request("dataset", "user-input", None);
        dataset.value.as_mut().unwrap()["cases"][0]["input"] =
            json!({"apiKey":"synthetic user input","answer":"expected legitimate input"});
        dataset.value.as_mut().unwrap()["cases"][0]["expected"] =
            json!({"answer":"","structured":{"arbitrary":"user expected material"}});
        manage(temp.path(), &dataset).unwrap();
    }
    #[test]
    fn invalid_types_summaries_hashes_and_result_bindings_fail_before_creation() {
        let temp = fixture();
        let base = populated("report");
        for (path, value) in [
            ("/rows/0/checks/correctness", json!("true")),
            ("/rows/0/answerHash", json!("invalid")),
            ("/rows/0/latencyMs", json!(-1)),
            ("/rows/0/generations/0/usage/inputTokens", json!(1.5)),
            (
                "/metrics/correctness",
                json!({"scored":1,"passed":0,"accuracy":1}),
            ),
            ("/metrics/cases/completed", json!(0)),
            (
                "/metrics/usage",
                json!({"status":"reported","inputTokens":1,"outputTokens":2,"totalTokens":5}),
            ),
            ("/scoring/model/rows/0/score", json!(2)),
            ("/scoring/human/0/ratedAt", json!(-1)),
        ] {
            let mut bad = request("report", "invalid", None);
            let mut v = base.clone();
            *v.pointer_mut(path).unwrap() = value;
            bad.value = Some(v);
            assert_eq!(bad.preflight().unwrap_err(), INVALID);
            assert_eq!(manage(temp.path(), &bad).unwrap_err(), INVALID);
        }
        let mut v = base.clone();
        v["rows"][0]["structuredResult"] = json!({"answer":"business"});
        assert!(validate_value("report", &v).is_err());
        v["resultDetailPolicy"] = json!("structured");
        for detail in [
            json!({"apiKey":"SYNTHETIC_CREDENTIAL_CANARY"}),
            json!({"nested":["Bearer synthetic-secret"]}),
            json!({"nested":{"password":"synthetic-secret"}}),
        ] {
            v["rows"][0]["structuredResult"] = detail;
            assert!(validate_value("report", &v).is_err());
        }
        let mut cp = populated("checkpoint");
        cp["cases"][0]["result"]["caseId"] = json!("case-other");
        assert!(validate_value("checkpoint", &cp).is_err());
        cp = populated("checkpoint");
        cp["inFlight"] = json!({});
        assert!(validate_value("checkpoint", &cp).is_err());
        cp = value("checkpoint");
        cp["status"] = json!("completed");
        assert!(validate_value("checkpoint", &cp).is_err());
        assert_eq!(fs::read_dir(temp.path()).unwrap().count(), 0);
    }
}
