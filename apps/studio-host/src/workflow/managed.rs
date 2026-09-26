//! Native CLI Runtime supervisor. The ledger and business worker have one custody boundary.
use super::{
    Lease, Store,
    execution::Execution,
    managed_wire::{self as wire, CHANNEL, Writer},
    protocol::{INVALID, keys, require},
    session,
};
use serde_json::{Value, json};
use std::{
    ffi::OsString,
    sync::mpsc,
    time::{Duration, Instant},
};
struct Task {
    lease: Option<Lease>,
    execution: Execution,
    record: Value,
}
fn cancel_worker(
    input: &Writer,
    cancelled: &mut bool,
    deadline: &mut Instant,
    approval: &mut Option<u64>,
) -> Result<(), String> {
    if !*cancelled {
        *cancelled = true;
        *deadline = (*deadline).min(Instant::now() + Duration::from_secs(5));
        input.send(&json!({"kind":"cancel"}))?;
        if let Some(id) = approval.take() {
            input.send(&json!({"kind":"reply","id":id,"ok":true,"value":false}))?;
        }
    }
    Ok(())
}
fn task_request(
    tasks: &mut Vec<Task>,
    current: &mut Option<usize>,
    worker: &Execution,
    root: &std::path::Path,
    frame: &Value,
    cancelled: bool,
) -> Result<Value, String> {
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
fn serve(output: &Writer) -> Result<(), String> {
    let (send, receive) = mpsc::sync_channel(8);
    wire::reader(std::io::stdin(), false, send.clone());
    let (source, first) = receive
        .recv_timeout(Duration::from_secs(10))
        .map_err(|_| CHANNEL)?;
    let first = first?.ok_or(CHANNEL)?;
    keys(&first, &["kind", "argv", "schemaVersion"], &[])?;
    require(!source && first["kind"] == "start" && first["schemaVersion"] == "blocky.runtime-session/v1", INVALID)?;
    let argv = first["argv"].as_array().ok_or(INVALID)?;
    require(
        argv.len() <= 256
            && argv
                .iter()
                .all(|v| v.as_str().is_some_and(|s| s.len() <= 16384))
            && first.to_string().len() <= 131072,
        INVALID,
    )?;
    let root = crate::profile::cli_root()?.join("workflow");
    let (node, script) = super::managed_assets::assets()?;
    let mut worker = Execution::spawn(
        &node,
        &[
            OsString::from("--no-addons"),
            OsString::from("--no-global-search-paths"),
            script.into_os_string(),
        ],
    )?;
    let input = Writer::new(worker.stdin().ok_or(CHANNEL)?);
    wire::reader(worker.take_stdout().ok_or(CHANNEL)?, true, send);
    worker.bootstrap()?;
    input.send(&first)?;
    let mut tasks: Vec<Task> = Vec::new();
    let mut current = None;
    let mut serial = 0u64;
    let mut approval = None;
    let mut cancelled = false;
    let mut deadline = Instant::now() + Duration::from_secs(310);
    let outcome: Result<Value, String> = (|| {
        loop {
            let (worker_frame, message) = receive
                .recv_timeout(deadline.saturating_duration_since(Instant::now()))
                .map_err(|_| CHANNEL)?;
            let message = message?.ok_or(CHANNEL)?;
            if !worker_frame {
                if message["kind"] == "cancel" {
                    keys(&message, &["kind"], &[])?;
                    cancel_worker(&input, &mut cancelled, &mut deadline, &mut approval)?;
                } else {
                    keys(&message, &["kind", "id", "value"], &[])?;
                    require(
                        message["kind"] == "approval"
                            && approval == message["id"].as_u64()
                            && approval.is_some()
                            && message["value"].is_boolean(),
                        INVALID,
                    )?;
                    input.send(&json!({"kind":"reply","id":approval.take(),"ok":true,"value":message["value"]}))?;
                }
                continue;
            }
            match message["kind"].as_str() {
                Some("cancel") => {
                    keys(&message, &["kind"], &[])?;
                    cancel_worker(&input, &mut cancelled, &mut deadline, &mut approval)?;
                }
                Some("output") => {
                    keys(&message, &["kind", "value"], &[])?;
                    output.send(&message)?;
                }
                Some("done") => {
                    keys(&message, &["kind", "value"], &[])?;
                    keys(&message["value"], &["code", "result"], &[])?;
                    require(
                        message["value"]["code"].as_u64().is_some_and(|n| n <= 255)
                            && current.is_none()
                            && approval.is_none(),
                        INVALID,
                    )?;
                    break Ok(message);
                }
                Some("workflow") => {
                    let id = message["id"].as_u64().ok_or(INVALID)?;
                    require(id == serial + 1 && id <= 4096, INVALID)?;
                    serial = id;
                    if message["operation"] == "approval" {
                        keys(&message, &["kind", "id", "operation", "value"], &[])?;
                        require(!cancelled && approval.is_none(), "BLK-WORKFLOW-CANCELLED")?;
                        approval = Some(id);
                        output
                            .send(&json!({"kind":"approval","id":id,"value":message["value"]}))?;
                    } else {
                        let result = task_request(
                            &mut tasks,
                            &mut current,
                            &worker,
                            &root,
                            &message,
                            cancelled,
                        );
                        let reply = match result {
                            Ok(value) => json!({"kind":"reply","id":id,"ok":true,"value":value}),
                            Err(code) => {
                                json!({"kind":"reply","id":id,"ok":false,"value":{"code":code}})
                            }
                        };
                        input.send(&reply)?;
                    }
                }
                _ => return Err(INVALID.into()),
            }
        }
    })();
    // Settlement is required on success, cancellation, malformed frames, EOF and timeout.
    worker.settle_process()?;
    for mut task in tasks {
        let proof = task.execution.stop()?;
        let mut lease = task.lease.take().ok_or(INVALID)?;
        lease.settle_execution(&proof)?;
        if task.record.get("active").is_none() {
            lease.release()?;
        }
    }
    output.send(&outcome?)
}
pub fn main() -> i32 {
    let output = Writer::new(std::io::stdout());
    match serve(&output) {
        Ok(()) => 0,
        Err(code) => {
            let _ = output.send(&json!({"kind":"error","code":code}));
            3
        }
    }
}
