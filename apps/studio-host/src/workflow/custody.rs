use super::{
    Lease, Store,
    execution::Execution,
    protocol::{INVALID, keys, require},
    session,
};
use serde_json::Value;
struct Task {
    lease: Option<Lease>,
    execution: Execution,
    record: Value,
}
#[derive(Default)]
pub(super) struct Custody {
    tasks: Vec<Task>,
    current: Option<usize>,
}
impl Custody {
    pub(super) fn closed(&self) -> bool {
        self.current.is_none()
    }
    pub(super) fn request(
        &mut self,
        worker: &Execution,
        root: &std::path::Path,
        frame: &Value,
        cancelled: bool,
    ) -> Result<Value, String> {
        let tasks = &mut self.tasks;
        let current = &mut self.current;
        let operation = frame["operation"].as_str().ok_or(INVALID)?;
        keys(
            frame,
            &["kind", "id", "operation"],
            match operation {
                "open" => &["request"],
                "commit" => &["action"],
                _ => &[],
            },
        )?;
        let settlement = operation == "close"
            || (operation == "commit"
                && matches!(
                    frame["action"]["kind"].as_str(),
                    Some("complete" | "uncertain" | "pause")
                ));
        require(!cancelled || settlement, "BLK-WORKFLOW-CANCELLED")?;
        if operation == "open" {
            require(current.is_none() && tasks.len() < 32, "BLK-WORKFLOW-OWNER")?;
            let store = Store::new(root.to_path_buf())?;
            let (mut lease, record) = session::open_task(&store, &frame["request"])?;
            let mut execution = worker.task_view()?;
            lease.bind_execution(&mut execution)?;
            *current = Some(tasks.len());
            tasks.push(Task {
                lease: Some(lease),
                execution,
                record: record.clone(),
            });
            return Ok(record);
        }
        let task = tasks
            .get_mut(current.ok_or("BLK-WORKFLOW-BINDING")?)
            .ok_or(INVALID)?;
        match operation {
            "read" => Ok(task.record.clone()),
            "commit" => {
                session::runtime_action(&frame["action"])?;
                task.record = task
                    .lease
                    .as_mut()
                    .ok_or(INVALID)?
                    .commit(&frame["action"])?;
                Ok(task.record.clone())
            }
            // Retain every lease until the shared worker actually stops. This is only a channel close.
            "close" => {
                *current = None;
                Ok(Value::Null)
            }
            _ => Err(INVALID.into()),
        }
    }
    pub(super) fn settle(&mut self, services_settled: bool) -> Result<(), String> {
        for mut task in self.tasks.drain(..) {
            let proof = task.execution.stop()?;
            let mut lease = task.lease.take().ok_or(INVALID)?;
            if services_settled {
                lease.settle_execution(&proof)?;
                if task.record.get("active").is_none() {
                    lease.release()?;
                }
            }
        }
        Ok(())
    }
}
