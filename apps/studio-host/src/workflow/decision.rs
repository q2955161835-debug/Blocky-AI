//! Explicit business approval. It never grants model/tool/RPA access or dispatches effects.
use super::{
    Store,
    protocol::{self, INVALID, keys, require},
};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::path::PathBuf;
pub fn dispatch(root: PathBuf, request: &Value) -> Result<Value, String> {
    keys(
        request,
        &[
            "schemaVersion",
            "operation",
            "projectId",
            "taskId",
            "revision",
            "stepId",
            "decision",
        ],
        &["approval"],
    )?;
    require(
        request["schemaVersion"] == "blocky.project-io/v1alpha1"
            && request["operation"] == "workflow-decide",
        INVALID,
    )?;
    for key in ["projectId", "taskId", "stepId"] {
        require(request[key].as_str().is_some_and(protocol::stable), INVALID)?;
    }
    require(
        matches!(request["decision"].as_str(), Some("approve" | "reject")),
        INVALID,
    )?;
    let revision = request["revision"]
        .as_u64()
        .filter(|v| (1..=65535).contains(v))
        .ok_or(INVALID)?;
    if let Some(approval) = request.get("approval") {
        require(
            approval.as_str().is_some_and(|s| {
                s.len() == 64
                    && s.bytes()
                        .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
            }),
            INVALID,
        )?;
    }
    let store = Store::new(root.clone())?;
    let task = request["taskId"].as_str().ok_or(INVALID)?;
    store.task_summary(request["projectId"].as_str().ok_or(INVALID)?, task)?;
    let record = store.read(task)?;
    let action = json!({"kind":"decide","revision":revision,"stepId":request["stepId"],"decision":request["decision"]});
    let after = super::transition(&record, &action)?;
    let binding = json!({"schemaVersion":"blocky.workflow-decision/v1","profile":crate::profile::identity(&crate::profile::prepare(&root)?),"taskId":task,"definition":record["definition"],"action":action});
    let digest = format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(&binding).map_err(|_| INVALID)?)
    );
    if let Some(approval) = request.get("approval") {
        require(approval == &digest, "BLK-WORKFLOW-APPROVAL")?;
        let mut lease = store.acquire(task, &record["definition"], revision)?;
        let saved = lease.commit(&action)?;
        lease.release()?;
        Ok(json!({"applied":true,"requestDigest":digest,"task":protocol::summary(&saved)?}))
    } else {
        Ok(
            json!({"applied":false,"requestDigest":digest,"task":protocol::summary(&record)?,"after":protocol::summary(&after)?}),
        )
    }
}
