//! Private CLI transport: one reviewed plan, caller-paced steps, unconditional settlement.
use super::*;
use std::{
    io::Write,
    sync::mpsc::{RecvTimeoutError, sync_channel},
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Request {
    schema_version: String,
    plan: Plan,
    browser: Option<BrowserStart>,
}
#[derive(Deserialize)]
#[serde(tag = "operation", rename_all = "lowercase", deny_unknown_fields)]
enum Command {
    Step {
        #[serde(rename = "requestId")]
        request_id: u32,
        #[serde(rename = "stepId")]
        step_id: String,
        #[serde(rename = "manualInput")]
        manual_input: Option<String>,
    },
    Close {},
}
const WIRE: &str = "blocky.rpa-module-session/v1";
fn emit(kind: &str, request_id: u32, value: Value) -> Result<(), String> {
    let mut output = std::io::stdout().lock();
    writeln!(
        output,
        "{}",
        json!({"schemaVersion":WIRE,"type":kind,"requestId":request_id,"value":value})
    )
    .and_then(|_| output.flush())
    .map_err(|_| "BLK-RPA-CANCELLED".into())
}
pub fn main() -> i32 {
    let host = match journal::local_root() {
        Ok(root) => Arc::new(RpaHost::with_journal(root)),
        Err(code) => {
            let _ = emit("settled", 0, json!({"settled":true,"code":code}));
            return 3;
        }
    };
    let outcome = (|| {
        let request: Request = serde_json::from_value(
            runner::read_frame(&mut std::io::stdin().lock())?.ok_or("BLK-RPA-INPUT-001")?,
        )
        .map_err(|_| "BLK-RPA-INPUT-001")?;
        if request.schema_version != WIRE {
            return Err("BLK-RPA-PLAN-001".into());
        }
        request.plan.validate()?;
        let stopped = Arc::new(AtomicBool::new(false));
        let token_slot = Arc::new(Mutex::new(None::<String>));
        let fault = Arc::new(Mutex::new(None::<String>));
        let (send, receive) = sync_channel(1);
        let reader_host = host.clone();
        let reader_stop = stopped.clone();
        let reader_token = token_slot.clone();
        let reader_fault = fault.clone();
        std::thread::spawn(move || {
            let mut input = std::io::stdin().lock();
            let mut last = 0;
            let error = (|| loop {
                let Some(value) = runner::read_frame(&mut input)? else {
                    return Ok::<(), String>(());
                };
                let command: Command =
                    serde_json::from_value(value).map_err(|_| "BLK-RPA-INPUT-001")?;
                match &command {
                    Command::Close {} => return Ok(()),
                    Command::Step {
                        request_id,
                        manual_input,
                        ..
                    } => {
                        if *request_id != last + 1
                            || *request_id > 100
                            || manual_input
                                .as_ref()
                                .is_some_and(|s| s.len() > 16384 || s.contains('\0'))
                        {
                            return Err("BLK-RPA-INPUT-001".into());
                        }
                        last = *request_id;
                        send.try_send(command).map_err(|_| "BLK-RPA-STATE-001")?;
                    }
                }
            })()
            .err();
            if let Ok(mut value) = reader_fault.lock() {
                *value = error;
            }
            reader_stop.store(true, Ordering::SeqCst);
            let _ = reader_host.cancel_authorization("module-approval");
            let token = reader_token.lock().ok().and_then(|s| s.clone());
            if let Some(token) = token {
                let _ = reader_host.stop(&token);
            }
        });
        if stopped.load(Ordering::SeqCst) {
            return Err("BLK-RPA-CANCELLED".into());
        }
        let grant = match request.browser {
            Some(browser) => host.authorize_browser("module-approval", request.plan, browser)?,
            None => host.authorize_attended("module-approval", request.plan)?,
        };
        let token = grant["sessionId"]
            .as_str()
            .ok_or("BLK-RPA-STATE-001")?
            .to_owned();
        *token_slot.lock().map_err(|_| "BLK-RPA-STATE-001")? = Some(token.clone());
        if stopped.load(Ordering::SeqCst) {
            return Err("BLK-RPA-CANCELLED".into());
        }
        let status = host.status(&token)?;
        emit("ready", 0, json!({"checkpointId":status["checkpointId"]}))?;
        loop {
            if stopped.load(Ordering::SeqCst) {
                break;
            }
            if now()
                > host.status(&token)?["expiresAt"]
                    .as_u64()
                    .ok_or("BLK-RPA-STATE-001")?
            {
                return Err("BLK-RPA-PERM-001".into());
            }
            match receive.recv_timeout(Duration::from_millis(100)) {
                Ok(Command::Step {
                    request_id,
                    step_id,
                    manual_input,
                }) => {
                    if stopped.load(Ordering::SeqCst) {
                        break;
                    }
                    match host.step(&token, &step_id, manual_input) {
                        Ok(result) => emit("result", request_id, result)?,
                        Err(code) => {
                            emit("error", request_id, json!({"code":code}))?;
                            return Err(code);
                        }
                    }
                }
                Ok(Command::Close {}) => break,
                Err(RecvTimeoutError::Timeout) => continue,
                Err(RecvTimeoutError::Disconnected) => break,
            }
        }
        if let Some(code) = fault.lock().map_err(|_| "BLK-RPA-STATE-001")?.take() {
            return Err(code);
        }
        Ok::<(), String>(())
    })();
    let settlement = host.shutdown();
    let code = settlement.as_ref().err().cloned().or_else(|| outcome.err());
    let _ = emit(
        "settled",
        0,
        json!({"settled":settlement.is_ok(),"code":code}),
    );
    if code.is_some() { 3 } else { 0 }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn module_transport_rejects_extra_fields_and_operations() {
        for value in [
            json!({"operation":"eval","source":"code"}),
            json!({"operation":"close","token":"x"}),
            json!({"operation":"step","requestId":1,"stepId":"owned","manualInput":null,"plan":{}}),
        ] {
            assert!(serde_json::from_value::<Command>(value).is_err());
        }
        assert!(
            serde_json::from_value::<Command>(
                json!({"operation":"step","requestId":1,"stepId":"owned","manualInput":"fixture"})
            )
            .is_ok()
        );
    }
}
