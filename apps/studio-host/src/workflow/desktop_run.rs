use super::{
    custody::Custody,
    desktop::{ERROR, Message},
    execution::Execution,
    managed_wire::{self as wire, Writer},
    protocol::{keys, require},
};
use serde_json::{Value, json};
use std::{
    collections::HashSet,
    ffi::OsString,
    path::Path,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
        mpsc::{Receiver, RecvTimeoutError, SyncSender},
    },
    time::{Duration, Instant},
};

const SERVICES: &[&str] = &[
    "knowledge.query",
    "agent.generate",
    "agent.memory",
    "agent.tool",
    "agent.validate-citations",
    "agent.close",
    "rpa.open",
    "rpa.perform",
    "rpa.close",
    "rpa.input",
];
pub(super) fn run(
    root: &Path,
    project: &str,
    initial: Value,
    send: SyncSender<Message>,
    receive: Receiver<Message>,
    cancellation: Arc<AtomicBool>,
    emit: impl Fn(Value) -> Result<(), String>,
) -> Result<(Value, String), String> {
    let (node, script) = super::managed_assets::assets()?;
    let mut worker = Execution::spawn(
        &node,
        &[
            OsString::from("--no-addons"),
            OsString::from("--no-global-search-paths"),
            script.into_os_string(),
        ],
    )?;
    let input = Writer::new(worker.stdin().ok_or(ERROR)?);
    wire::reader(worker.take_stdout().ok_or(ERROR)?, true, send);
    worker.bootstrap()?;
    input.send(
        &json!({"kind":"start","schemaVersion":"blocky.desktop-session/v1","request":initial}),
    )?;
    let mut custody = Custody::default();
    let mut pending = HashSet::new();
    let mut serial = 0u64;
    let mut cancelled = false;
    let mut deadline = Instant::now() + Duration::from_secs(310);
    let outcome = (|| -> Result<(Value, String), String> {
        loop {
            if cancellation.load(Ordering::SeqCst) && !cancelled {
                cancelled = true;
                deadline = deadline.min(Instant::now() + Duration::from_secs(5));
                input.send(&json!({"kind":"cancel"}))?;
            }
            require(Instant::now() < deadline, ERROR)?;
            let (from_worker, message) = match receive.recv_timeout(
                Duration::from_millis(50).min(deadline.saturating_duration_since(Instant::now())),
            ) {
                Ok(message) => message,
                Err(RecvTimeoutError::Timeout) => continue,
                Err(_) => return Err(ERROR.into()),
            };
            let message = message?.ok_or(ERROR)?;
            if !from_worker {
                match message["kind"].as_str() {
                    Some("reply") => {
                        let id = message["id"].as_u64().ok_or(ERROR)?;
                        require(pending.remove(&id), ERROR)?;
                        input.send(&message)?;
                    }
                    Some("control") => {
                        require(!cancelled, ERROR)?;
                        input.send(&message)?;
                    }
                    _ => return Err(ERROR.into()),
                }
                continue;
            }
            match message["kind"].as_str() {
                Some("event") => {
                    keys(&message, &["kind", "value"], &[])?;
                    require(message["value"]["projectId"] == project, ERROR)?;
                    emit(message)?;
                }
                Some("cancel") => {
                    keys(&message, &["kind"], &[])?;
                    cancellation.store(true, Ordering::SeqCst);
                }
                Some("workflow") => {
                    let id = message["id"].as_u64().ok_or(ERROR)?;
                    require(id == serial + 1 && id <= 4096, ERROR)?;
                    serial = id;
                    if message["operation"] == "service" {
                        keys(&message, &["kind", "id", "operation", "request"], &[])?;
                        let service = message["request"]["service"].as_str().ok_or(ERROR)?;
                        require(SERVICES.contains(&service) && pending.len() < 32, ERROR)?;
                        require(
                            !cancelled || matches!(service, "agent.close" | "rpa.close"),
                            ERROR,
                        )?;
                        pending.insert(id);
                        emit(json!({"kind":"service","id":id,"request":message["request"]}))?;
                    } else {
                        if message["operation"] == "open" {
                            require(
                                message["request"]["definition"]["projectId"] == project,
                                ERROR,
                            )?;
                        }
                        let result = custody.request(&worker, root, &message, cancelled);
                        let reply = match result {
                            Ok(value) => json!({"kind":"reply","id":id,"ok":true,"value":value}),
                            Err(code) => {
                                json!({"kind":"reply","id":id,"ok":false,"value":{"code":code}})
                            }
                        };
                        input.send(&reply)?;
                    }
                }
                Some("desktop-done") => {
                    keys(&message, &["kind", "value"], &[])?;
                    keys(&message["value"], &["result", "state"], &[])?;
                    require(custody.closed() && pending.is_empty(), ERROR)?;
                    let state = message["value"]["state"].as_str().ok_or(ERROR)?;
                    require(
                        state.len() <= 2 * 1024 * 1024
                            && matches!(
                                message["value"]["result"]["status"].as_str(),
                                Some("completed" | "cancelled" | "failed" | "waiting")
                            ),
                        ERROR,
                    )?;
                    return Ok((message["value"]["result"].clone(), state.into()));
                }
                _ => return Err(ERROR.into()),
            }
        }
    })();
    // Stop the native tree on every outcome, before asking the existing service owners to close.
    let stopped = worker.settle_process();
    let services_settled = settle_services(&receive, &emit).unwrap_or(false);
    // Without service acknowledgement, retain owners even when no business intent is active.
    let leases = custody.settle(services_settled && stopped.is_ok());
    stopped?;
    leases?;
    require(services_settled, ERROR)?;
    outcome
}
fn settle_services(
    receive: &Receiver<Message>,
    emit: &impl Fn(Value) -> Result<(), String>,
) -> Result<bool, String> {
    emit(json!({"kind":"settle"}))?;
    let deadline = Instant::now() + Duration::from_secs(35);
    loop {
        let (worker, message) = receive
            .recv_timeout(deadline.saturating_duration_since(Instant::now()))
            .map_err(|_| ERROR)?;
        if worker {
            continue;
        } // EOF from the now stopped worker is expected.
        let message = message?.ok_or(ERROR)?;
        if message["kind"] == "settled" {
            return Ok(message["ok"] == true);
        }
        require(
            matches!(message["kind"].as_str(), Some("reply" | "control")),
            ERROR,
        )?;
    }
}
