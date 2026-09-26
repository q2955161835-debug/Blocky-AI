use serde::{Deserialize, Serialize};
use std::collections::HashSet;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Plan {
    pub schema_version: String,
    pub plan_id: String,
    pub target: TargetRef,
    pub steps: Vec<Step>,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct TargetRef {
    pub kind: String,
    pub identity: String,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Step {
    pub step_id: String,
    pub action: Action,
    pub locator: Locator,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub value: Option<InputRef>,
    #[serde(default = "timeout")]
    pub timeout_ms: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub effect_key: Option<String>,
}
fn timeout() -> u64 {
    5000
}
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Action {
    Find,
    Read,
    Click,
    Fill,
    Wait,
    Screenshot,
}
impl Action {
    pub fn effect(self) -> bool {
        matches!(self, Self::Click | Self::Fill)
    }
    pub fn label(self) -> &'static str {
        match self {
            Self::Find => "查找",
            Self::Read => "读取",
            Self::Click => "点击",
            Self::Fill => "填写",
            Self::Wait => "等待",
            Self::Screenshot => "截图",
        }
    }
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase", deny_unknown_fields)]
pub enum Locator {
    Uia {
        #[serde(
            rename = "automationId",
            default,
            skip_serializing_if = "Option::is_none"
        )]
        automation_id: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        name: Option<String>,
        #[serde(
            rename = "controlType",
            default,
            skip_serializing_if = "Option::is_none"
        )]
        control_type: Option<String>,
    },
    Browser {
        role: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        name: Option<String>,
    },
    Coordinate {
        x: u32,
        y: u32,
        #[serde(rename = "riskAccepted")]
        risk_accepted: bool,
    },
}
impl Locator {
    pub fn description(&self) -> String {
        match self {
            Self::Uia {
                automation_id,
                name,
                control_type,
            } => [
                automation_id.as_ref().map(|v| format!("标识 {v}")),
                name.as_ref().map(|v| format!("名称 {v}")),
                control_type.as_ref().map(|v| format!("类型 {v}")),
            ]
            .into_iter()
            .flatten()
            .collect::<Vec<_>>()
            .join("；"),
            Self::Browser { role, name } => format!("{role} {}", name.as_deref().unwrap_or("")),
            Self::Coordinate { x, y, .. } => format!("坐标 {x}, {y}"),
        }
    }
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct InputRef {
    pub kind: String,
    #[serde(rename = "ref", default, skip_serializing_if = "Option::is_none")]
    pub reference: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sensitive: Option<bool>,
}
fn id(value: &str) -> bool {
    value.len() <= 200
        && regex::Regex::new(r"^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$")
            .unwrap()
            .is_match(value)
}
fn bounded(value: &Option<String>, limit: usize) -> bool {
    value.as_ref().is_none_or(|v| {
        !v.is_empty() && v.chars().count() <= limit && !v.chars().any(char::is_control)
    })
}
impl Plan {
    pub fn validate(&self) -> Result<(), String> {
        if self.schema_version != "blocky.rpa/v1"
            || !id(&self.plan_id)
            || !["windows", "browser"].contains(&self.target.kind.as_str())
            || self.target.identity.is_empty()
            || self.target.identity.len() > 300
            || self.steps.is_empty()
            || self.steps.len() > 100
        {
            return Err("BLK-RPA-PLAN-001".into());
        }
        let mut ids = HashSet::new();
        let mut effects = HashSet::new();
        for step in &self.steps {
            if !id(&step.step_id)
                || !ids.insert(&step.step_id)
                || !(100..=30000).contains(&step.timeout_ms)
            {
                return Err("BLK-RPA-PLAN-001".into());
            }
            match &step.locator {
                Locator::Uia {
                    automation_id,
                    name,
                    control_type,
                } => {
                    if self.target.kind != "windows" {
                        return Err("BLK-RPA-LOCATOR-002".into());
                    }
                    if automation_id.is_none() && name.is_none() && control_type.is_none()
                        || !bounded(automation_id, 200)
                        || !bounded(name, 200)
                        || !bounded(control_type, 80)
                    {
                        return Err("BLK-RPA-LOCATOR-001".into());
                    }
                }
                Locator::Browser { role, name } => {
                    if self.target.kind != "browser" {
                        return Err("BLK-RPA-LOCATOR-002".into());
                    }
                    if role.is_empty() || role.len() > 80 || !bounded(name, 200) {
                        return Err("BLK-RPA-LOCATOR-001".into());
                    }
                }
                Locator::Coordinate {
                    x,
                    y,
                    risk_accepted,
                } => {
                    if !risk_accepted || *x > 32767 || *y > 32767 {
                        return Err("BLK-RPA-LOCATOR-001".into());
                    }
                }
            }
            if (step.action == Action::Fill) != step.value.is_some() {
                return Err("BLK-RPA-INPUT-001".into());
            }
            if let Some(input) = &step.value {
                if input.sensitive == Some(true) && input.kind != "manual-input" {
                    return Err("BLK-RPA-SENSITIVE-001".into());
                }
                if !["manual-input", "secret-ref"].contains(&input.kind.as_str())
                    || input.reference.as_ref().is_some_and(|v| !id(v))
                    || input.kind == "secret-ref" && input.reference.is_none()
                    || input.kind == "manual-input" && input.reference.is_some()
                {
                    return Err("BLK-RPA-INPUT-001".into());
                }
            }
            if step.action.effect() && step.effect_key.is_none() {
                return Err("BLK-RPA-EFFECT-001".into());
            }
            if let Some(key) = &step.effect_key {
                if !id(key) || !effects.insert(key) {
                    return Err("BLK-RPA-EFFECT-002".into());
                }
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn sensitive_purpose_is_manual_only_and_survives_plan_roundtrip() {
        let mut raw = serde_json::to_value(fixture()).unwrap();
        raw["steps"][0]["action"] = json!("fill");
        raw["steps"][0]["value"] = json!({"kind":"manual-input","sensitive":true});
        let parsed = serde_json::from_value::<Plan>(raw.clone());
        assert!(parsed.is_ok(), "sensitive purpose must be a valid input declaration");
        let parsed = parsed.unwrap(); parsed.validate().unwrap();
        assert_eq!(serde_json::to_value(parsed).unwrap()["steps"][0]["value"]["sensitive"], true);
        raw["steps"][0]["value"] = json!({"kind":"secret-ref","ref":"provider-key","sensitive":true});
        assert_eq!(serde_json::from_value::<Plan>(raw).unwrap().validate().unwrap_err(), "BLK-RPA-SENSITIVE-001");
    }
    pub fn fixture() -> Plan {
        serde_json::from_value(json!({"schemaVersion":"blocky.rpa/v1","planId":"test", "target":{"kind":"windows","identity":"window"},"steps":[{"stepId":"click","action":"click","locator":{"kind":"uia","automationId":"submit"},"effectKey":"submit-once"}]})).unwrap()
    }
    #[test]
    fn rejects_unscoped_locator_duplicate_effect_and_plaintext_input() {
        let mut p = fixture();
        p.validate().unwrap();
        p.steps[0].locator = Locator::Uia {
            automation_id: None,
            name: None,
            control_type: None,
        };
        assert_eq!(p.validate().unwrap_err(), "BLK-RPA-LOCATOR-001");
        let mut p = fixture();
        let mut second = p.steps[0].clone();
        second.step_id = "again".into();
        p.steps.push(second);
        assert_eq!(p.validate().unwrap_err(), "BLK-RPA-EFFECT-002");
        let mut raw = serde_json::to_value(fixture()).unwrap();
        raw["steps"][0]["value"] = json!({"kind":"manual-input","text":"private"});
        assert!(serde_json::from_value::<Plan>(raw).is_err());
    }
    #[test]
    fn requires_secret_reference_and_bounded_unique_steps() {
        let mut p = fixture();
        p.steps[0].action = Action::Fill;
        p.steps[0].value = Some(InputRef {
            kind: "secret-ref".into(),
            reference: None,
            sensitive: None,
        });
        assert_eq!(p.validate().unwrap_err(), "BLK-RPA-INPUT-001");
        p.steps[0].value.as_mut().unwrap().reference = Some("secret".into());
        p.validate().unwrap();
        p.steps[0].timeout_ms = 30001;
        assert!(p.validate().is_err());
    }
}
