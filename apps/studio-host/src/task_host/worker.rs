use super::TaskRequest;
use crate::{
    project_store::{self, ProjectFiles},
    strict_json,
};
use serde::{Deserialize, Serialize};
use std::{
    io::{BufRead, Read, Write},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Input {
    pub request: TaskRequest,
    pub files: ProjectFiles,
}
pub fn worker_main() -> i32 {
    let mut first = String::new();
    let mut reader = std::io::BufReader::new(std::io::stdin().take(20 * 1024 * 1024 + 1));
    if reader.read_line(&mut first).is_err() || first.len() > 20 * 1024 * 1024 {
        return 3;
    }
    let input = strict_json::parse(first.as_bytes())
        .and_then(|v| serde_json::from_value::<Input>(v).map_err(|_| "BLK-TERM-101".into()));
    let Ok(input) = input else {
        return 3;
    };
    if input.request.validate().is_err() {
        return 3;
    }
    if input.request.task_id == "blocky.project-inventory" {
        let limit = input.request.parameters["limit"] as usize;
        let selected: Vec<_> = input.files.iter().take(limit).collect();
        let valid = project_store::validate_files(&input.files).is_ok();
        let manifest = input
            .files
            .get("project.json")
            .and_then(|raw| strict_json::parse(raw.as_bytes()).ok());
        let module_count = manifest
            .as_ref()
            .and_then(|m| m["modules"].as_array())
            .map_or(0, Vec::len);
        let resource_count = manifest
            .as_ref()
            .and_then(|m| m["resources"].as_array())
            .map_or(0, Vec::len);
        let summary = serde_json::json!({"schemaVersion":"blocky.task-inventory/v1alpha1","fileCount":input.files.len(),"moduleCount":module_count,"resourceCount":resource_count,"inspectedFiles":selected.len(),"limited":selected.len()<input.files.len(),"inspectedBytes":selected.iter().map(|(_,s)|s.len()).sum::<usize>(),"workspaceCount":selected.iter().filter(|(name,_)|name.starts_with("workspaces/")).count(),"valid":valid,"code":if valid{"BLK-INVENTORY-000"}else{"BLK-INVENTORY-001"}});
        return if writeln!(std::io::stdout(), "{summary}").is_err() {
            4
        } else if valid {
            0
        } else {
            3
        };
    }
    let cancelled = Arc::new(AtomicBool::new(false));
    let flag = cancelled.clone();
    std::thread::spawn(move || {
        let mut command = String::new();
        let _ = reader.by_ref().take(1024).read_to_string(&mut command);
        flag.store(true, Ordering::SeqCst);
    });
    for pass in 1..=input.request.parameters["passes"] {
        if cancelled.load(Ordering::SeqCst) {
            return 7;
        }
        let valid = project_store::validate_files(&input.files).is_ok();
        // Fixed, structured summaries only: never echo project source, stdin or environment.
        let line = serde_json::json!({"schemaVersion":"blocky.task-progress/v1alpha1","pass":pass,"fileCount":input.files.len(),"valid":valid,"code":if valid{"BLK-CHECK-000"}else{"BLK-CHECK-001"}});
        if writeln!(std::io::stdout(), "{line}").is_err() || std::io::stdout().flush().is_err() {
            return 4;
        }
        if !valid {
            return 3;
        }
        if pass < input.request.parameters["passes"] {
            let until = std::time::Instant::now()
                + Duration::from_millis(input.request.parameters["interval-ms"] as u64);
            while std::time::Instant::now() < until {
                if cancelled.load(Ordering::SeqCst) {
                    return 7;
                }
                std::thread::sleep(Duration::from_millis(5));
            }
        }
    }
    0
}
pub fn runner_main() -> i32 {
    use std::{io::BufRead, sync::Arc};
    let mut first = String::new();
    let mut reader = std::io::BufReader::new(std::io::stdin().take(20 * 1024 * 1024 + 1));
    let read = reader.read_line(&mut first);
    let input = read
        .map_err(|_| String::from("BLK-TERM-101"))
        .and_then(|_| strict_json::parse(first.as_bytes()))
        .and_then(|v| serde_json::from_value::<Input>(v).map_err(|_| "BLK-TERM-101".into()));
    let result = (|| -> Result<i32, String> {
        let input = input?;
        let host = Arc::new(super::TaskHost::default());
        let id = host.start(input.request, input.files)?;
        let reader_host = host.clone();
        let reader_id = id.clone();
        std::thread::spawn(move || {
            let mut command = String::new();
            let _ = reader.by_ref().take(1024).read_to_string(&mut command);
            let _ = reader_host.cancel(&reader_id);
        });
        loop {
            let state = host.snapshot(&id)?;
            if writeln!(
                std::io::stdout(),
                "{}",
                serde_json::to_string(&state).map_err(|_| "BLK-TERM-001")?
            )
            .is_err()
            {
                host.shutdown()?;
                return Ok(7);
            }
            let _ = std::io::stdout().flush();
            if state.active_processes == 0 {
                host.shutdown()?;
                return Ok(if state.status == "exited" {
                    0
                } else if ["cancelled", "timed-out"].contains(&state.status.as_str()) {
                    7
                } else {
                    3
                });
            }
            std::thread::sleep(Duration::from_millis(100));
        }
    })();
    match result {
        Ok(code) => code,
        Err(code) => {
            let _ = writeln!(
                std::io::stdout(),
                "{}",
                serde_json::json!({"schemaVersion":"blocky.task-error/v1alpha1","code":code})
            );
            3
        }
    }
}
