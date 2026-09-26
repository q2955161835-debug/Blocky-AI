//! One caller-owned CLI recording session. Control EOF always settles its capture.
use super::{Host, Request};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{
    io::Write,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
        mpsc::{RecvTimeoutError, sync_channel},
    },
    time::{Duration, Instant},
};
const WIRE: &str = "blocky.rpa-recording-session/v1";
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Initial {
    schema_version: String,
    request: Request,
}
#[derive(Debug, PartialEq)]
enum Control {
    Status,
    Stop,
}
fn control(value: Value) -> Result<Control, String> {
    if value.as_object().is_none_or(|value| value.len() != 1) {
        return Err("BLK-RPA-INPUT-001".into());
    }
    match value["operation"].as_str() {
        Some("status") => Ok(Control::Status),
        Some("stop") => Ok(Control::Stop),
        _ => Err("BLK-RPA-INPUT-001".into()),
    }
}
fn emit(sequence: &mut u32, kind: &str, value: Value) -> Result<(), String> {
    *sequence += 1;
    if *sequence > 2048 {
        return Err("BLK-RPA-LIMIT-001".into());
    }
    let line = serde_json::to_string(
        &json!({"schemaVersion":WIRE,"sequence":sequence,"type":kind,"value":value}),
    )
    .map_err(|_| "BLK-RPA-WORKER-001")?;
    if line.len() > 65536 {
        return Err("BLK-RPA-LIMIT-001".into());
    }
    let mut output = std::io::stdout().lock();
    writeln!(output, "{line}")
        .and_then(|_| output.flush())
        .map_err(|_| "BLK-RPA-CANCELLED".into())
}
pub fn main() -> i32 {
    let mut sequence = 0;
    let root = match crate::rpa::journal::local_root() {
        Ok(root) => root.join("recordings"),
        Err(_) => {
            let _ = emit(
                &mut sequence,
                "settled",
                json!({"settled":true,"code":"BLK-RPA-RUNTIME-001"}),
            );
            return 3;
        }
    };
    let host = Arc::new(Host::new(root));
    let outcome = (|| {
        let value = crate::rpa::runner::read_frame(&mut std::io::stdin().lock())?
            .ok_or("BLK-RPA-INPUT-001")?;
        let initial: Initial = serde_json::from_value(value).map_err(|_| "BLK-RPA-INPUT-001")?;
        if initial.schema_version != WIRE {
            return Err("BLK-RPA-INPUT-001".into());
        }
        let project_id = initial.request.project_id.clone();
        let session_id = initial.request.session_id.clone();
        let stopped = Arc::new(AtomicBool::new(false));
        let fault = Arc::new(Mutex::new(None::<String>));
        let (send, receive) = sync_channel(4);
        let reader_host = host.clone();
        let reader_stop = stopped.clone();
        let reader_fault = fault.clone();
        let reader_project = project_id.clone();
        let reader_session = session_id.clone();
        std::thread::spawn(move || {
            let mut input = std::io::stdin().lock();
            let result = (|| {
                for _ in 0..1024 {
                    let Some(value) = crate::rpa::runner::read_frame(&mut input)? else {
                        return Ok(());
                    };
                    match control(value)? {
                        Control::Stop => return Ok(()),
                        Control::Status => send.try_send(()).map_err(|_| "BLK-RPA-LIMIT-001")?,
                    }
                }
                Err::<(), String>("BLK-RPA-LIMIT-001".into())
            })();
            if let Ok(mut fault) = reader_fault.lock() {
                *fault = result.err();
            }
            reader_stop.store(true, Ordering::SeqCst);
            let _ = reader_host.stop(&reader_project, &reader_session);
        });
        emit(
            &mut sequence,
            "status",
            json!({"sessionId":session_id,"state":"awaiting-approval","count":0}),
        )?;
        let started = host.start(initial.request);
        let mut status = match started {
            Ok(value) => value,
            Err(code) if code == "BLK-RPA-CANCELLED" && stopped.load(Ordering::SeqCst) => {
                json!({"sessionId":session_id,"state":"stopped","count":0})
            }
            Err(code) => return Err(code),
        };
        let began = Instant::now();
        while !stopped.load(Ordering::SeqCst) {
            emit(&mut sequence, "status", status.clone())?;
            if matches!(status["state"].as_str(), Some("stopped" | "stopping")) {
                break;
            }
            if began.elapsed() > Duration::from_secs(660) {
                return Err("BLK-RPA-TIMEOUT-001".into());
            }
            match receive.recv_timeout(Duration::from_secs(1)) {
                Ok(()) | Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => break,
            }
            if stopped.load(Ordering::SeqCst) {
                break;
            }
            status = host.status(&project_id, &session_id)?;
        }
        let result = host.stop(&project_id, &session_id)?;
        if let Some(code) = result["code"].as_str() {
            return Err(code.to_owned());
        }
        if let Some(code) = fault.lock().map_err(|_| "BLK-RPA-STATE-001")?.clone() {
            return Err(code);
        }
        emit(&mut sequence, "recording", result)?;
        Ok::<(), String>(())
    })();
    let settlement = host.shutdown();
    let code = settlement.as_ref().err().cloned().or_else(|| outcome.err());
    let mut value = json!({"settled":settlement.is_ok()});
    if let Some(code) = code.as_ref() {
        value["code"] = json!(code);
    }
    let emitted = emit(&mut sequence, "settled", value);
    if code.is_none() && emitted.is_ok() {
        0
    } else {
        7
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn controls_cannot_attach_to_another_session_or_inject_actions() {
        assert_eq!(
            control(json!({"operation":"status"})).unwrap(),
            Control::Status
        );
        assert_eq!(control(json!({"operation":"stop"})).unwrap(), Control::Stop);
        for value in [
            json!({"operation":"stop","sessionId":"another"}),
            json!({"operation":"click"}),
            json!({"operation":"status","input":"private"}),
            json!([]),
            json!(null),
        ] {
            assert!(control(value).is_err());
        }
    }
}
