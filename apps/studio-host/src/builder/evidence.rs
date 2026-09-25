use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    io::Write,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
const ERROR: &str = "BLK-BUILDER-EVIDENCE";
pub fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResponseMetadata {
    pub provider: String,
    pub model: String,
    pub response_id: String,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub total_tokens: u64,
    pub finish_reason: String,
}
fn identifier(s: &str, max: usize) -> bool {
    !s.is_empty()
        && s.len() <= max
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"-_.:/".contains(&b))
}
impl ResponseMetadata {
    fn valid(&self) -> bool {
        ["deepseek", "xirang"].contains(&self.provider.as_str())
            && identifier(&self.model, 128)
            && identifier(&self.response_id, 256)
            && [
                "stop",
                "tool_calls",
                "length",
                "content_filter",
                "insufficient_system_resource",
            ]
            .contains(&self.finish_reason.as_str())
            && self.input_tokens <= 10_000_000
            && self.output_tokens <= 2048
            && self.input_tokens.checked_add(self.output_tokens) == Some(self.total_tokens)
    }
}
pub fn response_metadata(bytes: &[u8], provider: &str) -> Option<ResponseMetadata> {
    let v = crate::strict_json::parse(bytes).ok()?;
    let meta = ResponseMetadata {
        provider: provider.into(),
        model: v["model"].as_str()?.into(),
        response_id: v["id"].as_str()?.into(),
        input_tokens: v["usage"]["prompt_tokens"].as_u64()?,
        output_tokens: v["usage"]["completion_tokens"].as_u64()?,
        total_tokens: v["usage"]["total_tokens"].as_u64()?,
        finish_reason: v["choices"][0]["finish_reason"].as_str()?.into(),
    };
    meta.valid().then_some(meta)
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Attempt {
    pub turn: u64,
    pub started_at_ms: u64,
    pub completed_at_ms: Option<u64>,
    pub network_attempted: bool,
    pub outcome: String,
    pub response: Option<ResponseMetadata>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Evidence {
    pub schema_version: String,
    pub request_id: String,
    pub project_id: String,
    pub started_at_ms: u64,
    pub completed_at_ms: Option<u64>,
    pub outcome: String,
    pub attempts: Vec<Attempt>,
    pub tools: Vec<String>,
}
fn outcome(s: &str) -> bool {
    ["running", "started", "response", "completed"].contains(&s)
        || (s.starts_with("BLK-")
            && s.len() < 80
            && s.bytes()
                .all(|b| b.is_ascii_uppercase() || b.is_ascii_digit() || b == b'-'))
}
impl Evidence {
    pub fn new(start: &super::BuilderStart) -> Self {
        Self {
            schema_version: "blocky.builder-evidence/v1".into(),
            request_id: start.request.request_id.clone(),
            project_id: start.request.project_id.clone(),
            started_at_ms: now(),
            completed_at_ms: None,
            outcome: "running".into(),
            attempts: vec![],
            tools: vec![],
        }
    }
    fn validate(&self) -> Result<(), String> {
        if self.schema_version != "blocky.builder-evidence/v1"
            || !crate::project_store::stable(&self.request_id)
            || !crate::project_store::stable(&self.project_id)
            || self.request_id.len() > 200
            || self.project_id.len() > 200
            || self.attempts.len() > 4
            || self.tools.len() > 64
            || !outcome(&self.outcome)
            || self.started_at_ms == 0
            || match self.completed_at_ms {
                None => self.outcome != "running",
                Some(end) => {
                    end < self.started_at_ms
                        || !(self.outcome == "completed" || self.outcome.starts_with("BLK-"))
                }
            }
            || self
                .tools
                .iter()
                .any(|s| !["inspect", "draft", "patch", "verify"].contains(&s.as_str()))
            || self.attempts.iter().enumerate().any(|(i, a)| {
                a.turn != i as u64 + 1
                    || !outcome(&a.outcome)
                    || a.started_at_ms < self.started_at_ms
                    || (i > 0
                        && self.attempts[i - 1]
                            .completed_at_ms
                            .is_none_or(|end| end > a.started_at_ms))
                    || match a.completed_at_ms {
                        None => {
                            a.outcome != "started"
                                || self.completed_at_ms.is_some()
                                || i + 1 != self.attempts.len()
                        }
                        Some(end) => {
                            end < a.started_at_ms
                                || self
                                    .completed_at_ms
                                    .is_some_and(|session_end| end > session_end)
                                || !(a.outcome == "response" || a.outcome.starts_with("BLK-"))
                        }
                    }
                    || (a.outcome == "response" && (!a.network_attempted || a.response.is_none()))
                    || (a.response.is_some()
                        && (!a.network_attempted || a.completed_at_ms.is_none()))
                    || a.response.as_ref().is_some_and(|r| !r.valid())
            })
        {
            return Err(ERROR.into());
        }
        let v = serde_json::to_value(self).map_err(|_| ERROR)?;
        if super::input_guard::credentials(&v) {
            return Err(ERROR.into());
        }
        Ok(())
    }
    pub fn save(&self, root: &Path) -> Result<(), String> {
        self.validate()?;
        let path = path(root)?;
        let dir = path.parent().ok_or(ERROR)?;
        std::fs::create_dir_all(dir).map_err(|_| ERROR)?;
        let mut tmp = tempfile::NamedTempFile::new_in(dir).map_err(|_| ERROR)?;
        let bytes = serde_json::to_vec(self).map_err(|_| ERROR)?;
        tmp.write_all(&bytes)
            .and_then(|_| tmp.as_file().sync_all())
            .map_err(|_| ERROR)?;
        tmp.persist(path).map_err(|_| ERROR)?;
        Ok(())
    }
}
fn path(root: &Path) -> Result<PathBuf, String> {
    let dir = root.join("builder-evidence");
    let path = dir.join("latest.json");
    for candidate in [&dir, &path] {
        if candidate.exists()
            && std::fs::symlink_metadata(candidate)
                .map_err(|_| ERROR)?
                .file_type()
                .is_symlink()
        {
            return Err(ERROR.into());
        }
    }
    Ok(path)
}
pub fn read(root: &Path, id: &str) -> Result<Value, String> {
    if !crate::project_store::stable(id) || id.len() > 200 {
        return Err(ERROR.into());
    }
    let path = path(root)?;
    if std::fs::metadata(&path).map_err(|_| ERROR)?.len() > 65536 {
        return Err(ERROR.into());
    }
    let value = crate::strict_json::parse(&std::fs::read(path).map_err(|_| ERROR)?)?;
    let evidence: Evidence = serde_json::from_value(value).map_err(|_| ERROR)?;
    evidence.validate()?;
    if evidence.request_id != id {
        return Err(ERROR.into());
    }
    serde_json::to_value(evidence).map_err(|_| ERROR.into())
}
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn rejects_contradictory_attempts_and_timestamps() {
        let valid = json!({"schemaVersion":"blocky.builder-evidence/v1","requestId":"r-1","projectId":"p-1","startedAtMs":100,"completedAtMs":120,"outcome":"completed","tools":[],"attempts":[{"turn":1,"startedAtMs":101,"completedAtMs":119,"networkAttempted":true,"outcome":"response","response":{"provider":"deepseek","model":"deepseek-flash","responseId":"response-1","inputTokens":4,"outputTokens":2,"totalTokens":6,"finishReason":"stop"}}]});
        assert!(serde_json::from_value::<Evidence>(valid.clone())
            .unwrap()
            .validate()
            .is_ok());
        for (pointer, value) in [
            ("/attempts/0/networkAttempted", json!(false)),
            ("/attempts/0/completedAtMs", Value::Null),
            ("/attempts/0/startedAtMs", json!(99)),
            ("/attempts/0/completedAtMs", json!(121)),
            ("/completedAtMs", json!(90)),
            ("/outcome", json!("running")),
            ("/attempts/0/outcome", json!("started")),
        ] {
            let mut bad = valid.clone();
            *bad.pointer_mut(pointer).unwrap() = value;
            assert!(
                serde_json::from_value::<Evidence>(bad)
                    .unwrap()
                    .validate()
                    .is_err(),
                "{pointer}"
            );
        }
    }
    #[test]
    fn preserves_usage_for_rejected_response_without_content() {
        let v = json!({"id":"response-1","model":"deepseek-flash","choices":[{"finish_reason":"tool_calls","message":{"content":"synthetic-private-body"}}],"usage":{"prompt_tokens":4,"completion_tokens":2,"total_tokens":6},"Authorization":"synthetic-private-header"});
        let m = response_metadata(v.to_string().as_bytes(), "deepseek").unwrap();
        let safe = serde_json::to_string(&m).unwrap();
        assert!(!safe.contains("private"));
        assert!(safe.contains("response-1"));
        let mut bad = v;
        bad["id"] = json!("Bearer secret");
        assert!(response_metadata(bad.to_string().as_bytes(), "deepseek").is_none());
    }
    #[test]
    fn evidence_read_is_strict_scoped_and_latest_only() {
        let root = tempfile::tempdir().unwrap();
        let e = Evidence {
            schema_version: "blocky.builder-evidence/v1".into(),
            request_id: "request-1".into(),
            project_id: "project-1".into(),
            started_at_ms: now(),
            completed_at_ms: Some(now()),
            outcome: "BLK-PATCH-002".into(),
            attempts: vec![],
            tools: vec!["patch".into()],
        };
        e.save(root.path()).unwrap();
        assert_eq!(
            read(root.path(), "request-1").unwrap()["outcome"],
            "BLK-PATCH-002"
        );
        assert!(read(root.path(), "other").is_err());
        let mut v = serde_json::to_value(e).unwrap();
        v["secret"] = json!("synthetic-private");
        std::fs::write(path(root.path()).unwrap(), v.to_string()).unwrap();
        assert!(read(root.path(), "request-1").is_err());
    }
}
