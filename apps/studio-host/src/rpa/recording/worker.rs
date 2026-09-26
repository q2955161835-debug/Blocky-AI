//! Private metadata-only worker. Every UIA call stays on this MTA thread.
use super::{protocol::Options, uia::Capture};
use crate::rpa::{runner::read_frame, target::Target};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{
    io::Write,
    sync::mpsc,
    time::{Duration, Instant},
};
pub(super) const SCHEMA: &str = "blocky.rpa-recording-ipc/v1";
const WIRE: &str = "BLK-RPA-WIRE-001";

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
enum Operation {
    Start { target: Target, options: Options },
    Status,
    Stop,
    Shutdown,
}
fn parse(mut value: Value, expected: u64) -> Result<Operation, String> {
    let object = value.as_object_mut().ok_or(WIRE)?;
    if object.remove("schemaVersion") != Some(json!(SCHEMA))
        || object.remove("requestId") != Some(json!(expected))
    {
        return Err(WIRE.into());
    }
    // Serde's internally tagged unit variants can otherwise discard extra fields.
    let keys: &[&str] = match object.get("kind").and_then(Value::as_str) {
        Some("start") => &["kind", "target", "options"],
        Some("status" | "stop" | "shutdown") => &["kind"],
        _ => return Err(WIRE.into()),
    };
    if object.len() != keys.len() || object.keys().any(|key| !keys.contains(&key.as_str())) {
        return Err(WIRE.into());
    }
    serde_json::from_value(value).map_err(|_| WIRE.into())
}
fn emit(id: u64, result: Result<Value, String>) -> bool {
    let value = match result {
        Ok(value) => json!({"schemaVersion":SCHEMA,"requestId":id,"ok":true,"value":value}),
        Err(code) => json!({"schemaVersion":SCHEMA,"requestId":id,"ok":false,"code":code}),
    };
    let Ok(mut bytes) = serde_json::to_vec(&value) else {
        return false;
    };
    bytes.push(b'\n');
    if bytes.len() > 65536 {
        return false;
    }
    let mut output = std::io::stdout().lock();
    output
        .write_all(&bytes)
        .and_then(|_| output.flush())
        .is_ok()
}
pub fn main() -> i32 {
    let (send, receive) = mpsc::sync_channel(4);
    std::thread::spawn(move || {
        let mut input = std::io::stdin().lock();
        loop {
            let frame = read_frame(&mut input);
            let ended = !matches!(&frame, Ok(Some(_)));
            if send.try_send(frame).is_err() || ended {
                break;
            }
        }
    });
    let mut capture: Option<Capture> = None;
    let mut sequence = 1;
    let lifetime = Instant::now();
    let mut last_request = Instant::now();
    loop {
        // No detached subscription survives its parent or an abandoned private pipe.
        if lifetime.elapsed() > Duration::from_secs(660)
            || last_request.elapsed() > Duration::from_secs(30)
        {
            return 0;
        }
        let value = match receive.recv_timeout(Duration::from_millis(100)) {
            Ok(Ok(Some(value))) => value,
            Err(mpsc::RecvTimeoutError::Timeout) => {
                if capture
                    .as_mut()
                    .is_some_and(|capture| capture.status().is_err())
                {
                    return 3;
                }
                continue;
            }
            _ => return 0,
        };
        last_request = Instant::now();
        let operation = match parse(value, sequence) {
            Ok(operation) => operation,
            Err(code) => {
                emit(sequence, Err(code));
                return 3;
            }
        };
        let shutdown = matches!(operation, Operation::Shutdown);
        let result = match operation {
            Operation::Start { target, options } if capture.is_none() => {
                Capture::start(target, options).and_then(|mut started| {
                    let status = started.status()?;
                    capture = Some(started);
                    Ok(status)
                })
            }
            Operation::Start { .. } => Err("BLK-RPA-STATE-001".into()),
            Operation::Status => capture
                .as_mut()
                .ok_or("BLK-RPA-STATE-001".into())
                .and_then(Capture::status),
            Operation::Stop => capture
                .as_mut()
                .ok_or("BLK-RPA-STATE-001".into())
                .and_then(|capture| capture.stop("stopped")),
            Operation::Shutdown => capture
                .as_mut()
                .map(|capture| capture.stop("stopped").map(|_| ()))
                .unwrap_or(Ok(()))
                .map(|_| json!({"settled":true})),
        };
        if !emit(sequence, result) {
            return 3;
        }
        if shutdown {
            return 0;
        }
        sequence += 1;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn worker_rejects_extra_fields_and_sequence_replay() {
        assert!(
            parse(
                json!({"schemaVersion":SCHEMA,"requestId":1,"kind":"stop"}),
                1
            )
            .is_ok()
        );
        for value in [
            json!({"schemaVersion":SCHEMA,"requestId":1,"kind":"stop","value":"PRIVATE"}),
            json!({"schemaVersion":SCHEMA,"requestId":0,"kind":"status"}),
            json!({"schemaVersion":"wrong","requestId":1,"kind":"status"}),
        ] {
            assert!(parse(value, 1).is_err());
        }
    }
}
