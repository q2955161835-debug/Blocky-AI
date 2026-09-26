//! Read-only product projection; root comes from native profile selection.
use super::{
    Store,
    protocol::{INVALID, keys, require},
};
use serde_json::Value;
use std::path::PathBuf;

pub fn dispatch(root: PathBuf, request: &Value) -> Result<Value, String> {
    let operation = request["operation"].as_str().ok_or(INVALID)?;
    require(
        matches!(operation, "workflow-list" | "workflow-show"),
        INVALID,
    )?;
    let mut required = vec!["schemaVersion", "operation", "projectId"];
    if operation == "workflow-show" {
        required.push("taskId");
    }
    keys(request, &required, &[])?;
    require(
        request["schemaVersion"] == "blocky.project-io/v1alpha1",
        INVALID,
    )?;
    let project = request["projectId"].as_str().ok_or(INVALID)?;
    require(super::protocol::stable(project), INVALID)?;
    let task = if operation == "workflow-show" {
        let task = request["taskId"].as_str().ok_or(INVALID)?;
        require(super::protocol::stable(task), INVALID)?;
        Some(task)
    } else {
        None
    };
    let store = Store::new(root)?;
    match task {
        Some(id) => store.task_summary(project, id),
        None => store.summaries(project),
    }
}
