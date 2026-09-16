mod process;
mod worker;
use crate::project_store::ProjectFiles;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::BTreeMap,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};
pub use worker::runner_main;
pub use worker::worker_main;
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TaskRequest {
    pub task_id: String,
    pub parameters: BTreeMap<String, i64>,
    pub timeout_ms: u64,
    pub output_budget_bytes: usize,
}
pub fn definition() -> Value {
    serde_json::from_str(include_str!(
        "../../../../packages/terminal-protocol/src/project-check.json"
    ))
    .expect("registered task definition")
}
impl TaskRequest {
    pub fn validate(&self) -> Result<(), String> {
        let d = definition();
        if self.task_id != d["taskId"]
            || self.timeout_ms == 0
            || self.timeout_ms > d["timeoutMs"].as_u64().unwrap_or(0)
            || self.output_budget_bytes < 256
            || self.output_budget_bytes > d["outputBudgetBytes"].as_u64().unwrap_or(0) as usize
            || self.parameters.len() != 2
        {
            return Err("BLK-TERM-101".into());
        }
        for p in d["parameters"].as_array().ok_or("BLK-TERM-101")? {
            let value = *self
                .parameters
                .get(p["parameterId"].as_str().ok_or("BLK-TERM-101")?)
                .ok_or("BLK-TERM-101")?;
            for rule in p["validationRules"].as_array().ok_or("BLK-TERM-101")? {
                match rule["kind"].as_str() {
                    Some("minimum")
                        if value < rule["argument"].as_i64().ok_or("BLK-TERM-101")? =>
                    {
                        return Err("BLK-TERM-101".into());
                    }
                    Some("maximum")
                        if value > rule["argument"].as_i64().ok_or("BLK-TERM-101")? =>
                    {
                        return Err("BLK-TERM-101".into());
                    }
                    Some("minimum" | "maximum" | "integer") => {}
                    _ => return Err("BLK-TERM-101".into()),
                }
            }
        }
        if !cfg!(windows) {
            return Err("BLK-TERM-102".into());
        }
        Ok(())
    }
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskSnapshot {
    pub schema_version: &'static str,
    pub request_id: String,
    pub task_id: String,
    pub status: String,
    pub exit_code: Option<i32>,
    pub output: String,
    pub output_bytes: usize,
    pub dropped_bytes: usize,
    pub truncated: bool,
    pub active_processes: usize,
}
pub(super) struct Task {
    pub snapshot: Arc<Mutex<TaskSnapshot>>,
    pub cancel: Arc<AtomicBool>,
}
#[derive(Default)]
pub struct TaskHost {
    tasks: Mutex<BTreeMap<String, Task>>,
    closing: AtomicBool,
}
impl TaskHost {
    pub fn start(&self, request: TaskRequest, files: ProjectFiles) -> Result<String, String> {
        request.validate()?;
        if self.closing.load(Ordering::SeqCst) {
            return Err("BLK-WINDOW-001".into());
        }
        // No arbitrary cwd/environment/command or caller-owned terminal handle is accepted.
        if files.len() > 1000 || files.values().map(String::len).sum::<usize>() > 8 * 1024 * 1024 {
            return Err("BLK-TERM-101".into());
        }
        let mut tasks = self.tasks.lock().map_err(|_| "BLK-TERM-001")?;
        if self.closing.load(Ordering::SeqCst) {
            return Err("BLK-WINDOW-001".into());
        }
        if tasks
            .values()
            .any(|t| t.snapshot.lock().is_ok_and(|s| s.active_processes > 0))
        {
            return Err("BLK-TERM-103".into());
        }
        let id = format!("task-{}", uuid::Uuid::new_v4());
        let task = Task {
            snapshot: Arc::new(Mutex::new(TaskSnapshot {
                schema_version: "blocky.task-result/v1alpha1",
                request_id: id.clone(),
                task_id: request.task_id.clone(),
                status: "starting".into(),
                exit_code: None,
                output: String::new(),
                output_bytes: 0,
                dropped_bytes: 0,
                truncated: false,
                active_processes: 1,
            })),
            cancel: Arc::new(AtomicBool::new(false)),
        };
        process::launch(request, files, task.snapshot.clone(), task.cancel.clone())?;
        if tasks.len() >= 16 {
            tasks.clear();
        }
        tasks.insert(id.clone(), task);
        Ok(id)
    }
    pub fn snapshot(&self, id: &str) -> Result<TaskSnapshot, String> {
        self.tasks
            .lock()
            .map_err(|_| "BLK-TERM-001")?
            .get(id)
            .ok_or("BLK-TERM-003")?
            .snapshot
            .lock()
            .map(|s| s.clone())
            .map_err(|_| "BLK-TERM-001".into())
    }
    pub fn cancel(&self, id: &str) -> Result<(), String> {
        self.tasks
            .lock()
            .map_err(|_| "BLK-TERM-001")?
            .get(id)
            .ok_or("BLK-TERM-003")?
            .cancel
            .store(true, Ordering::SeqCst);
        Ok(())
    }
    pub fn active(&self) -> usize {
        self.tasks
            .lock()
            .map(|tasks| {
                tasks
                    .values()
                    .filter(|t| t.snapshot.lock().is_ok_and(|s| s.active_processes > 0))
                    .count()
            })
            .unwrap_or(1)
    }
    pub fn shutdown(&self) -> Result<(), String> {
        self.closing.store(true, Ordering::SeqCst);
        {
            for task in self.tasks.lock().map_err(|_| "BLK-WINDOW-001")?.values() {
                task.cancel.store(true, Ordering::SeqCst);
            }
        }
        let until = std::time::Instant::now() + Duration::from_secs(3);
        while self.active() > 0 {
            if std::time::Instant::now() > until {
                return Err("BLK-WINDOW-001".into());
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        Ok(())
    }
}
impl Drop for TaskHost {
    fn drop(&mut self) {
        let _ = self.shutdown();
    }
}
