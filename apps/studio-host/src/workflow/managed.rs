//! Native CLI Runtime supervisor. The ledger and business worker have one custody boundary.
use super::{
    custody::Custody,
    execution::Execution,
    managed_wire::{self as wire, CHANNEL, Writer},
    protocol::{INVALID, keys, require},
};
use serde_json::{Value, json};
use std::{
    ffi::OsString,
    sync::mpsc,
    time::{Duration, Instant},
};
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
            && first.to_string().len() <= super::protocol::RECORD_LIMIT,
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
    let mut custody = Custody::default();
    let mut serial = 0u64;
    let mut approval = None;
    let mut cancelled = false;
    let mut deadline = Instant::now() + Duration::from_secs(86410);
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
                            && custody.closed()
                            && approval.is_none(),
                        INVALID,
                    )?;
                    break Ok(message);
                }
                Some("workflow") => {
                    let id = message["id"].as_u64().ok_or(INVALID)?;
                    wire::service_sequence(serial, id).map_err(|_| INVALID)?;
                    serial = id;
                    if message["operation"] == "approval" {
                        keys(&message, &["kind", "id", "operation", "value"], &[])?;
                        require(!cancelled && approval.is_none(), "BLK-WORKFLOW-CANCELLED")?;
                        approval = Some(id);
                        output
                            .send(&json!({"kind":"approval","id":id,"value":message["value"]}))?;
                    } else {
                        let result = custody.request(
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
    custody.settle(true)?;
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
