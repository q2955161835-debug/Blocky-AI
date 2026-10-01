//! Experimental English candidate relevance routing, using the pinned CPU cross-encoder.
//! A relevance logit is not a class probability; descriptions and thresholds require calibration.
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeSet,
    sync::atomic::{AtomicBool, Ordering},
    time::Instant,
};
pub const MODEL: &str = "ms-marco-minilm-l6-v2-int8-v1";
const INVALID: &str = "BLK-DECISION-INVALID";
fn id(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 128
        && s.as_bytes()[0].is_ascii_lowercase()
        && s.split(['.', '_', '-']).all(|p| {
            !p.is_empty()
                && p.bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
        })
}
fn english(s: &str, max: usize) -> bool {
    !s.trim().is_empty()
        && s.len() <= max
        && s.is_ascii()
        && s.bytes()
            .all(|b| !b.is_ascii_control() || [b'\n', b'\r', b'\t'].contains(&b))
        && s.bytes().any(|b| b.is_ascii_alphabetic())
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Label {
    pub id: String,
    pub description: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Rule {
    pub contains: String,
    pub label: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DecisionRequest {
    pub schema_version: String,
    pub request_id: String,
    pub project_id: String,
    pub session_id: String,
    pub language: String,
    pub text: String,
    pub labels: Vec<Label>,
    #[serde(default)]
    pub rules: Vec<Rule>,
    pub threshold: f64,
    pub fallback_label: String,
    pub model_id: String,
}
impl DecisionRequest {
    pub fn validate(&self) -> Result<(), String> {
        if self.schema_version != "blocky.decision-request/v1"
            || !id(&self.request_id)
            || !id(&self.project_id)
            || !id(&self.session_id)
            || self.language != "en"
            || !english(&self.text, 4096)
            || self.labels.is_empty()
            || self.labels.len() > 8
            || self.rules.len() > 32
            || !self.threshold.is_finite()
            || !(-100.0..=100.0).contains(&self.threshold)
            || !id(&self.fallback_label)
            || self.model_id != MODEL
        {
            return Err(INVALID.into());
        }
        let labels = self.labels.iter().map(|l| &l.id).collect::<BTreeSet<_>>();
        if labels.len() != self.labels.len()
            || self.labels.iter().any(|l| {
                !id(&l.id)
                    || !english(&l.description, 1024)
                    || l.description.split_whitespace().count() < 2
            })
            || self
                .rules
                .iter()
                .any(|r| !english(&r.contains, 256) || !labels.contains(&r.label))
        {
            return Err(INVALID.into());
        }
        Ok(())
    }
    pub fn preflight(&self) -> Result<Value, String> {
        self.validate()?;
        Ok(
            json!({"requestDigest":format!("{:x}",Sha256::digest(serde_json::to_vec(self).map_err(|_|INVALID)?)),
            "projectId":self.project_id,"sessionId":self.session_id,"requestId":self.request_id,"modelId":self.model_id,
            "labels":self.labels.iter().map(|l|&l.id).collect::<Vec<_>>(),"textBytes":self.text.len(),"experimental":true}),
        )
    }
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DecisionRecord {
    pub schema_version: String,
    pub request_id: String,
    pub project_id: String,
    pub session_id: String,
    pub model_id: String,
    pub model_version: String,
    pub model_sha256: String,
    pub label: String,
    pub mode: String,
    pub score_kind: String,
    pub score: Option<f32>,
    pub candidate_scores: Vec<CandidateScore>,
    pub threshold: f64,
    pub inference_ms: u64,
    pub backend_invoked: bool,
    pub experimental: bool,
    pub score_meaning: String,
    pub input_policy: String,
    pub rule_index: Option<usize>,
    pub error_code: Option<String>,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CandidateScore {
    pub label: String,
    pub score: f32,
}
fn check(cancel: &AtomicBool) -> Result<(), String> {
    if cancel.load(Ordering::Acquire) {
        Err("BLK-DECISION-CANCELLED".into())
    } else {
        Ok(())
    }
}
fn identity() -> Result<(String, String), String> {
    let definitions: Value =
        serde_json::from_str(include_str!("../knowledge/models.json")).map_err(|_| INVALID)?;
    let model = definitions
        .as_array()
        .ok_or(INVALID)?
        .iter()
        .find(|v| v["id"] == MODEL)
        .ok_or(INVALID)?;
    Ok((
        model["revision"].as_str().ok_or(INVALID)?.into(),
        model["files"][0]["sha256"].as_str().ok_or(INVALID)?.into(),
    ))
}
/// Caller checks the shared run budget and grants before/after; no authorization lock
/// should remain held during CPU inference. Cancellation prevents subsequent pairs/results.
pub fn decision(request: &DecisionRequest, cancel: &AtomicBool) -> Result<DecisionRecord, String> {
    decision_with(request, cancel, |query, description| {
        let values = crate::knowledge::score_decision(query, &[description])?;
        if values.len() != 1 {
            return Err("BLK-DECISION-BACKEND".into());
        }
        Ok(values[0])
    })
}
fn decision_with(
    request: &DecisionRequest,
    cancel: &AtomicBool,
    mut scorer: impl FnMut(&str, &str) -> Result<f32, String>,
) -> Result<DecisionRecord, String> {
    check(cancel)?;
    request.validate()?;
    let started = Instant::now();
    let (version, sha) = identity()?;
    let mut record = DecisionRecord {
        schema_version: "blocky.decision-record/v1".into(),
        request_id: request.request_id.clone(),
        project_id: request.project_id.clone(),
        session_id: request.session_id.clone(),
        model_id: MODEL.into(),
        model_version: version,
        model_sha256: sha,
        label: request.fallback_label.clone(),
        mode: "fallback".into(),
        score_kind: "none".into(),
        score: None,
        candidate_scores: Vec::new(),
        threshold: request.threshold,
        inference_ms: 0,
        backend_invoked: false,
        experimental: true,
        score_meaning: "relevance-logit-not-probability".into(),
        input_policy: "english-pair-truncate512-logit-v1".into(),
        rule_index: None,
        error_code: None,
    };
    let text = request.text.to_ascii_lowercase();
    if let Some((index, rule)) = request
        .rules
        .iter()
        .enumerate()
        .find(|(_, r)| text.contains(&r.contains.to_ascii_lowercase()))
    {
        record.label = rule.label.clone();
        record.mode = "rule".into();
        record.rule_index = Some(index);
        check(cancel)?;
        return Ok(record);
    }
    for label in &request.labels {
        check(cancel)?;
        record.backend_invoked = true;
        let value = scorer(&request.text, &label.description);
        check(cancel)?;
        match value {
            Ok(score) if score.is_finite() && (-100.0..=100.0).contains(&score) => {
                record.candidate_scores.push(CandidateScore {
                    label: label.id.clone(),
                    score,
                })
            }
            result => {
                record.candidate_scores.clear();
                record.error_code = Some(match result {
                    Err(e)
                        if [
                            "BLK-EMBED-MISSING",
                            "BLK-EMBED-MODEL-CORRUPT",
                            "BLK-EMBED-INIT",
                            "BLK-RERANK-INIT",
                            "BLK-RERANK-INFERENCE",
                        ]
                        .contains(&e.as_str()) =>
                    {
                        e
                    }
                    Err(e) if e == "BLK-KNOW-CANCELLED" => {
                        return Err("BLK-DECISION-CANCELLED".into());
                    }
                    _ => "BLK-DECISION-BACKEND".into(),
                });
                record.inference_ms = started.elapsed().as_millis().min(86400000) as u64;
                return Ok(record);
            }
        }
    }
    // First declared candidate wins exact ties. No implicit positive threshold.
    let best = record
        .candidate_scores
        .iter()
        .reduce(|best, value| {
            if value.score > best.score {
                value
            } else {
                best
            }
        })
        .ok_or(INVALID)?;
    record.score = Some(best.score);
    record.score_kind = "logit".into();
    if f64::from(best.score) >= request.threshold {
        record.label = best.label.clone();
        record.mode = "model".into();
    } else {
        record.error_code = Some("BLK-DECISION-BELOW-THRESHOLD".into());
    }
    record.inference_ms = started.elapsed().as_millis().min(86400000) as u64;
    check(cancel)?;
    Ok(record)
}
#[cfg(test)]
mod tests {
    use super::*;
    fn request() -> DecisionRequest {
        serde_json::from_value(json!({"schemaVersion":"blocky.decision-request/v1","requestId":"request","projectId":"project","sessionId":"session","language":"en","text":"Where is Paris located?",
        "labels":[{"id":"geography","description":"Paris is a city in France. Geography concerns places and countries."},{"id":"sports","description":"Soccer and basketball are sports played by teams."}],"rules":[],"threshold":-100.0,"fallbackLabel":"unknown","modelId":MODEL})).unwrap()
    }
    #[test]
    fn rules_bypass_scorer_and_invalid_input_fails() {
        let mut r = request();
        r.rules = vec![Rule {
            contains: "PARIS".into(),
            label: "geography".into(),
        }];
        let out = decision_with(&r, &AtomicBool::new(false), |_, _| {
            panic!("rule must not infer")
        })
        .unwrap();
        assert_eq!(out.mode, "rule");
        assert!(!out.backend_invoked);
        assert!(out.score.is_none());
        r.threshold = f64::NAN;
        assert!(r.validate().is_err());
        r.threshold = 0.;
        r.language = "zh".into();
        assert!(r.validate().is_err());
    }
    #[test]
    fn deterministic_unit_scorer_threshold_and_backend_failures_are_explicit() {
        let mut r = request();
        r.threshold = 2.;
        let out = decision_with(&r, &AtomicBool::new(false), |_, _| Ok(-1.)).unwrap();
        assert_eq!(out.mode, "fallback");
        assert_eq!(out.score_kind, "logit");
        assert_eq!(
            out.error_code.as_deref(),
            Some("BLK-DECISION-BELOW-THRESHOLD")
        );
        let out = decision_with(&r, &AtomicBool::new(false), |_, _| {
            Err("BLK-EMBED-MISSING".into())
        })
        .unwrap();
        assert_eq!(out.score_kind, "none");
        assert_eq!(out.error_code.as_deref(), Some("BLK-EMBED-MISSING"));
        assert!(out.candidate_scores.is_empty());
        let out = decision_with(&r, &AtomicBool::new(false), |_, _| Ok(f32::INFINITY)).unwrap();
        assert_eq!(out.error_code.as_deref(), Some("BLK-DECISION-BACKEND"));
    }
    #[test]
    fn cancellation_during_pair_prevents_next_pair_and_result() {
        let r = request();
        let cancel = AtomicBool::new(false);
        let mut count = 0;
        let result = decision_with(&r, &cancel, |_, _| {
            count += 1;
            cancel.store(true, Ordering::Release);
            Ok(1.)
        });
        assert_eq!(result.err().as_deref(), Some("BLK-DECISION-CANCELLED"));
        assert_eq!(count, 1);
    }
    #[test]
    #[ignore = "requires pinned public CPU model assets through BLOCKY_MODEL_DIR"]
    fn actual_english_candidate_relevance_applicability() {
        assert!(
            std::env::var_os("BLOCKY_MODEL_DIR").is_some(),
            "set pinned model root"
        );
        let cancel = AtomicBool::new(false);
        let mut r = request();
        let geography = decision(&r, &cancel).unwrap();
        assert_eq!(geography.mode, "model");
        assert_eq!(geography.label, "geography");
        assert_eq!(geography.score_kind, "logit");
        r.text = "Which sports are played by teams with a ball?".into();
        let sports = decision(&r, &cancel).unwrap();
        assert_eq!(sports.label, "sports");
        assert_eq!(sports.mode, "model");
        r.threshold = 100.;
        let low = decision(&r, &cancel).unwrap();
        assert_eq!(low.label, "unknown");
        assert_eq!(low.mode, "fallback");
        eprintln!(
            "decision-real-cpu-evidence {}",
            json!({"geography":geography,"sports":sports,"fallback":low,"externalApi":false,"applicability":"English candidate descriptions only; requires task-specific threshold calibration"})
        );
    }
    #[test]
    #[ignore = "set BLOCKY_MODEL_DIR to a nonexistent isolated test model root"]
    fn actual_missing_backend_controlled_fallback() {
        let path = std::env::var_os("BLOCKY_MODEL_DIR").expect("isolated missing model root");
        assert!(
            !std::path::Path::new(&path)
                .parent()
                .unwrap()
                .join(MODEL)
                .exists(),
            "must use missing test root"
        );
        let result = decision(&request(), &AtomicBool::new(false)).unwrap();
        assert_eq!(result.mode, "fallback");
        assert_eq!(result.label, "unknown");
        assert_eq!(result.score_kind, "none");
        assert_eq!(result.error_code.as_deref(), Some("BLK-EMBED-MISSING"));
        assert!(result.candidate_scores.is_empty());
    }
}
