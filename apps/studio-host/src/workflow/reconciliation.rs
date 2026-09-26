//! Explicit operator reconciliation; Runtime commits cannot call this operation.
use super::{
    Store,
    protocol::{self, INVALID, keys, require},
};
use serde_json::{Value, json};
use std::path::PathBuf;

pub(super) struct Request<'a> {
    pub project: &'a str,
    pub task: &'a str,
    pub step: &'a str,
    pub direction: &'a str,
    pub revision: u64,
    pub action: Value,
    pub approval: Option<&'a str>,
}
pub fn dispatch(root: PathBuf, input: &Value) -> Result<Value, String> {
    let completed = input["outcome"] == "completed";
    let mut fields = vec![
        "schemaVersion",
        "operation",
        "projectId",
        "taskId",
        "revision",
        "stepId",
        "direction",
        "outcome",
    ];
    if completed {
        fields.push("state");
    }
    keys(input, &fields, &["approval"])?;
    protocol::bounded(input, 262144)?;
    require(
        input["schemaVersion"] == "blocky.project-io/v1alpha1"
            && input["operation"] == "workflow-reconcile",
        INVALID,
    )?;
    for key in ["projectId", "taskId", "stepId"] {
        require(input[key].as_str().is_some_and(protocol::stable), INVALID)?;
    }
    require(
        matches!(input["direction"].as_str(), Some("forward" | "rollback"))
            && matches!(
                input["outcome"].as_str(),
                Some("completed" | "not-executed")
            ),
        INVALID,
    )?;
    let revision = input["revision"]
        .as_u64()
        .filter(|v| (1..=65535).contains(v))
        .ok_or(INVALID)?;
    let approval = if let Some(value) = input.get("approval") {
        let text = value.as_str().ok_or(INVALID)?;
        require(
            text.len() == 64
                && text
                    .bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)),
            INVALID,
        )?;
        Some(text)
    } else {
        None
    };
    let mut action = json!({"kind":"resolve","revision":revision,"outcome":input["outcome"]});
    if completed {
        action["state"] = input["state"].clone();
    }
    Store::new(root)?.reconcile(&Request {
        project: input["projectId"].as_str().ok_or(INVALID)?,
        task: input["taskId"].as_str().ok_or(INVALID)?,
        step: input["stepId"].as_str().ok_or(INVALID)?,
        direction: input["direction"].as_str().ok_or(INVALID)?,
        revision,
        action,
        approval,
    })
}
