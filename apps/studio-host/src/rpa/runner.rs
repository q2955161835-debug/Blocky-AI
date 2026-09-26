use super::*;
use serde::Deserialize;
use std::io::{BufRead, Read, Write};
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Request {
    schema_version: String,
    plan: Plan,
    recovery: Option<recovery::Request>,
    #[serde(default)]
    inputs: HashMap<String, String>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Control {
    operation: String,
}
fn emit(kind: &str, value: Value) -> bool {
    let mut output = std::io::stdout().lock();
    writeln!(
        output,
        "{}",
        json!({"schemaVersion":"blocky.rpa-session/v1","type":kind,"value":value})
    )
    .is_ok()
        && output.flush().is_ok()
}
fn read_frame(input: &mut impl BufRead) -> Result<Option<Value>, String> {
    let mut bytes = Vec::new();
    let count = Read::by_ref(input)
        .take(65537)
        .read_until(b'\n', &mut bytes)
        .map_err(|_| "BLK-RPA-INPUT-001")?;
    if count == 0 {
        return Ok(None);
    }
    if bytes.len() > 65536 || bytes.last() != Some(&b'\n') {
        return Err("BLK-RPA-LIMIT-001".into());
    }
    crate::strict_json::parse(&bytes)
        .map(Some)
        .map_err(|_| "BLK-RPA-INPUT-001".into())
}
pub fn main() -> i32 {
    let result = (|| {
        let value = read_frame(&mut std::io::stdin().lock())?.ok_or("BLK-RPA-INPUT-001")?;
        let request: Request = serde_json::from_value(value).map_err(|_| "BLK-RPA-INPUT-001")?;
        if request.schema_version != "blocky.rpa-session/v1" {
            return Err("BLK-RPA-PLAN-001".into());
        }
        request.plan.validate()?;
        let host = Arc::new(RpaHost::with_journal(journal::local_root()?));
        let start = request
            .recovery
            .as_ref()
            .map(|recovery| {
                host.recovery_snapshot(&request.plan, recovery)
                    .map(|saved| saved.next)
            })
            .transpose()?
            .unwrap_or(0);
        for (id, value) in &request.inputs {
            if value.len() > 16384
                || value.contains('\0')
                || !request.plan.steps.iter().any(|s| {
                    s.step_id == *id && s.value.as_ref().is_some_and(|v| v.kind == "manual-input")
                })
            {
                return Err("BLK-RPA-INPUT-001".into());
            }
        }
        if request.plan.steps.iter().skip(start).any(|s| {
            s.value.as_ref().is_some_and(|v| v.kind == "manual-input")
                && !request.inputs.contains_key(&s.step_id)
        }) {
            return Err("BLK-RPA-INPUT-002".into());
        }
        let steps = request.plan.steps.clone();
        let token_slot = Arc::new(Mutex::new(None::<String>));
        let stopped = Arc::new(AtomicBool::new(false));
        let control_host = host.clone();
        let control_token = token_slot.clone();
        let control_stop = stopped.clone();
        std::thread::spawn(move || {
            let mut input = std::io::stdin().lock();
            loop {
                let command = match read_frame(&mut input)
                    .and_then(|v| v.ok_or_else(|| "BLK-RPA-CANCELLED".into()))
                    .and_then(|v| {
                        serde_json::from_value::<Control>(v).map_err(|_| "BLK-RPA-INPUT-001".into())
                    }) {
                    Ok(value) => value,
                    Err(_) => {
                        control_stop.store(true, Ordering::SeqCst);
                        let _ = control_host.cancel_authorization("cli-approval");
                        if let Ok(token) = control_token.lock() {
                            if let Some(token) = token.as_ref() {
                                let _ = control_host.stop(token);
                            }
                        }
                        break;
                    }
                };
                if command.operation == "stop" {
                    control_stop.store(true, Ordering::SeqCst);
                }
                let token = control_token.lock().ok().and_then(|v| v.clone());
                let result = match (token, command.operation.as_str()) {
                    (Some(token), "pause") => control_host
                        .pause(&token)
                        .and_then(|_| control_host.status(&token)),
                    (Some(token), "resume") => control_host
                        .resume(&token)
                        .and_then(|_| control_host.status(&token)),
                    (Some(token), "stop") => control_host
                        .stop(&token)
                        .and_then(|_| control_host.status(&token)),
                    (Some(token), "status") => control_host.status(&token),
                    (None, "stop") => control_host
                        .cancel_authorization("cli-approval")
                        .map(|_| json!({"status":"stopped","active":false})),
                    _ => Err("BLK-RPA-STATE-001".into()),
                };
                match result {
                    Ok(value) => {
                        emit("status", value);
                    }
                    Err(code) => {
                        emit("control.error", json!({"code":code}));
                    }
                }
            }
        });
        if !emit(
            "run.preparing",
            json!({"planId":request.plan.plan_id,"steps":steps.len()}),
        ) {
            return Err("BLK-RPA-CANCELLED".into());
        }
        if stopped.load(Ordering::SeqCst) {
            return Err("BLK-RPA-CANCELLED".into());
        }
        let grant = match request.recovery {
            Some(recovery) => host.recover_attended("cli-approval", request.plan, recovery)?,
            None => host.authorize_attended("cli-approval", request.plan)?,
        };
        let token = grant["sessionId"]
            .as_str()
            .ok_or("BLK-RPA-STATE-001")?
            .to_owned();
        *token_slot.lock().map_err(|_| "BLK-RPA-STATE-001")? = Some(token.clone());
        let execution = (|| {
            if !emit("checkpoint.created", host.status(&token)?) {
                return Err("BLK-RPA-CANCELLED".into());
            }
            for step in steps.iter().skip(start) {
                while host.status(&token)?["status"] == "paused" && !stopped.load(Ordering::SeqCst)
                {
                    std::thread::sleep(Duration::from_millis(20));
                }
                if stopped.load(Ordering::SeqCst) {
                    return Err("BLK-RPA-CANCELLED".into());
                }
                if !emit(
                    "step.started",
                    json!({"stepId":step.step_id,"action":step.action}),
                ) {
                    return Err("BLK-RPA-CANCELLED".into());
                }
                let value = host.step(
                    &token,
                    &step.step_id,
                    request.inputs.get(&step.step_id).cloned(),
                )?;
                if step.action == Action::Read
                    && !emit("step.result", json!({"stepId":step.step_id,"result":value}))
                {
                    return Err("BLK-RPA-CANCELLED".into());
                }
                if !emit(
                    "step.completed",
                    json!({"stepId":step.step_id,"action":step.action}),
                ) {
                    return Err("BLK-RPA-CANCELLED".into());
                }
            }
            Ok::<(), String>(())
        })();
        let status = host.status(&token)?;
        let settlement = host.shutdown();
        // Even on an uncertain effect, emit the bounded receipt ledger after settlement.
        emit(
            "checkpoint",
            json!({"state":status,"settled":settlement.is_ok()}),
        );
        settlement?;
        execution
    })();
    match result {
        Ok(()) => {
            emit("run.completed", json!({"modelApiCalled":false}));
            0
        }
        Err(code) => {
            emit("run.failed", json!({"code":code,"modelApiCalled":false}));
            3
        }
    }
}
