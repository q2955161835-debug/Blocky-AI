use crate::rpa::protocol::{Action, InputRef, Locator, Plan, Step, TargetRef};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
const ERROR: &str = "BLK-RPA-RECORD-001";
const REASONS: [&str; 5] = [
    "stopped",
    "limit",
    "expired",
    "target-lost",
    "capture-failed",
];

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Options {
    pub session_id: String,
    pub project_id: String,
    pub target: TargetRef,
}
impl Options {
    pub fn validate(&self) -> Result<(), String> {
        if [&self.session_id, &self.project_id]
            .iter()
            .any(|id| id.len() > 200 || !crate::project_store::stable(id))
            || !["browser", "windows"].contains(&self.target.kind.as_str())
            || self.target.identity.is_empty()
            || self.target.identity.len() > 300
        {
            return Err(ERROR.into());
        }
        Ok(())
    }
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct CapturedAction {
    pub action: Action,
    pub locator: Locator,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sensitive: Option<bool>,
}
fn metadata(value: &str, limit: usize) -> bool {
    static CREDENTIAL: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let credential = CREDENTIAL.get_or_init(|| regex::Regex::new(r"(?i)\bBearer\s+\S+|\b(?:sk|ghp|gho|github_pat)[_-][A-Za-z0-9_-]{12,}|(?:password|secret|token|api[-_ ]?key|密码|密钥)\s*[:=]\s*\S+").expect("fixed recording regex"));
    !value.is_empty()
        && value == value.trim()
        && value.encode_utf16().count() <= limit
        && !value.chars().any(char::is_control)
        && !credential.is_match(value)
}
impl CapturedAction {
    pub fn validate(&self, kind: &str) -> Result<(), String> {
        if !matches!(self.action, Action::Click | Action::Fill) {
            return Err(ERROR.into());
        }
        let valid = match &self.locator {
            Locator::Uia {
                automation_id,
                name,
                control_type,
            } => {
                kind == "windows"
                    && (automation_id.is_some() || name.is_some())
                    && automation_id.as_ref().is_none_or(|v| metadata(v, 200))
                    && name.as_ref().is_none_or(|v| metadata(v, 200))
                    && control_type.as_ref().is_none_or(|v| metadata(v, 80))
            }
            Locator::Browser { role, name } => {
                kind == "browser"
                    && [
                        "button",
                        "link",
                        "textbox",
                        "searchbox",
                        "checkbox",
                        "radio",
                        "combobox",
                        "spinbutton",
                        "switch",
                        "menuitem",
                        "tab",
                    ]
                    .contains(&role.as_str())
                    && name.as_ref().is_some_and(|v| metadata(v, 200))
            }
            _ => false,
        };
        if valid { Ok(()) } else { Err(ERROR.into()) }
    }
}
fn steps(actions: &[CapturedAction]) -> Vec<Step> {
    actions
        .iter()
        .enumerate()
        .map(|(i, action)| Step {
            step_id: format!("recorded-{}", i + 1),
            action: action.action,
            locator: action.locator.clone(),
            value: (action.action == Action::Fill).then(|| InputRef {
                kind: "manual-input".into(),
                reference: None,
                sensitive: None,
            }),
            timeout_ms: 5000,
            effect_key: Some(format!("effect-{}", i + 1)),
        })
        .collect()
}
fn plan(options: &Options, actions: &[CapturedAction]) -> Option<Plan> {
    (!actions.is_empty()).then(|| Plan {
        schema_version: "blocky.rpa/v1".into(),
        plan_id: options.session_id.clone(),
        target: options.target.clone(),
        steps: steps(actions),
    })
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RecordingResult {
    schema_version: String,
    session_id: String,
    project_id: String,
    target: TargetRef,
    requires_review: bool,
    started_at: u64,
    stopped_at: u64,
    reason: String,
    omitted: u32,
    actions: Vec<CapturedAction>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    plan: Option<Plan>,
}
/// Independent native validation for worker/sidecar output. It cannot mint a grant.
pub fn validate_result(input: &Value, options: &Options) -> Result<(), String> {
    if serde_json::to_vec(input).map_err(|_| ERROR)?.len() > 60000 {
        return Err(ERROR.into());
    }
    let result: RecordingResult = serde_json::from_value(input.clone()).map_err(|_| ERROR)?;
    options.validate()?;
    if result.schema_version != "blocky.rpa-recording-result/v1"
        || !result.requires_review
        || result.session_id != options.session_id
        || result.project_id != options.project_id
        || result.target.kind != options.target.kind
        || result.target.identity != options.target.identity
        || result.actions.len() > 100
        || result.omitted > 10000
        || result.stopped_at < result.started_at
        || result.stopped_at > 9007199254740991
        || !REASONS.contains(&result.reason.as_str())
    {
        return Err(ERROR.into());
    }
    for action in &result.actions {
        action.validate(&options.target.kind)?;
    }
    if let Some(plan) = &result.plan {
        plan.validate()?;
    }
    if serde_json::to_value(&result.plan).map_err(|_| ERROR)?
        != serde_json::to_value(plan(options, &result.actions)).map_err(|_| ERROR)?
    {
        return Err(ERROR.into());
    }
    Ok(())
}
pub struct RecordingBuffer {
    options: Options,
    started: u64,
    actions: Vec<CapturedAction>,
    omitted: u32,
    sealed: Option<Value>,
}
impl RecordingBuffer {
    pub fn new(options: Value, now: u64) -> Result<Self, String> {
        let options: Options = serde_json::from_value(options).map_err(|_| ERROR)?;
        options.validate()?;
        if now > 9007199254140991 {
            return Err(ERROR.into());
        }
        Ok(Self {
            options,
            started: now,
            actions: vec![],
            omitted: 0,
            sealed: None,
        })
    }
    pub fn append(&mut self, input: Value, now: u64) -> bool {
        if self.sealed.is_some() {
            return false;
        }
        if now >= self.started + 600000 {
            let _ = self.seal("expired", now);
            return false;
        }
        let Some(action) = serde_json::from_value::<CapturedAction>(input)
            .ok()
            .filter(|a| a.validate(&self.options.target.kind).is_ok())
        else {
            self.omit();
            return false;
        };
        if action.action == Action::Fill {
            if let Some(previous) = self.actions.last_mut() {
                if previous.action == Action::Fill
                    && serde_json::to_value(&previous.locator).ok()
                        == serde_json::to_value(&action.locator).ok()
                {
                    if action.sensitive == Some(true) {
                        previous.sensitive = Some(true);
                    }
                    return true;
                }
            }
        }
        let mut candidate = self.actions.clone();
        candidate.push(action.clone());
        if serde_json::to_vec(&json!({"actions":candidate,"steps":steps(&candidate)}))
            .map_or(true, |b| b.len() > 49152)
        {
            self.omit();
            let _ = self.seal("limit", now);
            return false;
        }
        self.actions.push(action);
        if self.actions.len() == 100 {
            let _ = self.seal("limit", now);
        }
        true
    }
    pub fn omit(&mut self) {
        if self.sealed.is_none() {
            self.omitted = (self.omitted + 1).min(10000);
        }
    }
    pub fn status(&mut self, now: u64) -> Result<Value, String> {
        if self.sealed.is_none() && now >= self.started + 600000 {
            self.seal("expired", now)?;
        }
        let mut result = json!({"sessionId":self.options.session_id,"state":if self.sealed.is_some(){"stopped"}else{"recording"},"count":self.actions.len(),"omitted":self.omitted,"startedAt":self.started,"expiresAt":self.started+600000});
        if let Some(sealed) = &self.sealed {
            result["reason"] = sealed["reason"].clone();
        }
        Ok(result)
    }
    pub fn seal(&mut self, reason: &str, now: u64) -> Result<Value, String> {
        if let Some(result) = &self.sealed {
            return Ok(result.clone());
        }
        if !REASONS.contains(&reason) {
            return Err(ERROR.into());
        }
        let result = RecordingResult {
            schema_version: "blocky.rpa-recording-result/v1".into(),
            session_id: self.options.session_id.clone(),
            project_id: self.options.project_id.clone(),
            target: self.options.target.clone(),
            requires_review: true,
            started_at: self.started,
            stopped_at: now.max(self.started),
            reason: if now >= self.started + 600000 {
                "expired"
            } else {
                reason
            }
            .into(),
            omitted: self.omitted,
            actions: self.actions.clone(),
            plan: plan(&self.options, &self.actions),
        };
        let value = serde_json::to_value(result).map_err(|_| ERROR)?;
        validate_result(&value, &self.options)?;
        self.sealed = Some(value.clone());
        Ok(value)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn options() -> Value {
        json!({"sessionId":"recording-one","projectId":"project-one","target":{"kind":"windows","identity":"window-one"}})
    }
    fn fill() -> Value {
        json!({"action":"fill","locator":{"kind":"uia","automationId":"input","controlType":"Edit"},"sensitive":true})
    }
    #[test]
    fn recording_never_accepts_value_or_grants_execution() {
        let mut buffer = RecordingBuffer::new(options(), 100).unwrap();
        assert!(buffer.append(fill(), 101));
        assert!(buffer.append(fill(), 102));
        let mut invalid = fill();
        invalid["value"] = json!("PRIVATE_INPUT");
        assert!(!buffer.append(invalid, 103));
        let result = buffer.seal("stopped", 104).unwrap();
        assert_eq!(result["actions"].as_array().unwrap().len(), 1);
        assert_eq!(result["omitted"], 1);
        assert_eq!(
            result["plan"]["steps"][0]["value"],
            json!({"kind":"manual-input"})
        );
        assert!(!result.to_string().contains("PRIVATE_INPUT"));
        assert!(!result.to_string().contains("grant"));
        assert!(!buffer.append(fill(), 105));
        assert_eq!(buffer.seal("target-lost", 106).unwrap(), result);
    }
    #[test]
    fn recording_bounds_time_and_wire_bytes() {
        let mut timed = RecordingBuffer::new(options(), 100).unwrap();
        assert!(!timed.append(fill(), 600100));
        assert_eq!(timed.seal("stopped", 600101).unwrap()["reason"], "expired");
        let mut buffer = RecordingBuffer::new(options(), 100).unwrap();
        for n in 0..100 {
            buffer.append(json!({"action":"click","locator":{"kind":"uia","automationId":format!("button-{n}"),"name":"界".repeat(200),"controlType":"Button"}}), 101);
        }
        let result = buffer.seal("stopped", 102).unwrap();
        assert_eq!(result["reason"], "limit");
        assert!(result["actions"].as_array().unwrap().len() < 100);
        assert!(serde_json::to_vec(&result).unwrap().len() < 60000);
    }
    #[test]
    fn recording_rejects_foreign_or_sensitive_metadata() {
        let mut buffer = RecordingBuffer::new(options(), 100).unwrap();
        for input in [
            json!({"action":"click","locator":{"kind":"browser","role":"button","name":"Save"}}),
            json!({"action":"click","locator":{"kind":"uia","controlType":"Button"}}),
            json!({"action":"fill","locator":{"kind":"uia","name":"password=private"}}),
            json!({"action":"read","locator":{"kind":"uia","automationId":"input"}}),
        ] {
            assert!(!buffer.append(input, 101));
        }
        let result = buffer.seal("target-lost", 102).unwrap();
        assert_eq!(result["omitted"], 4);
        assert!(result.get("plan").is_none());
    }
}
