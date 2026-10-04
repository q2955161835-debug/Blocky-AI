//! Private run-long ledger coordinator. Closing it is not evidence that effects settled.
use super::{
    Store,
    protocol::{self, INVALID, keys, require},
};
use serde_json::{Value, json};
use std::{
    io::{BufRead, BufReader, Read, Write},
    path::PathBuf,
    sync::mpsc::sync_channel,
    time::{Duration, Instant},
};
const WIRE: &str = "blocky.workflow-session/v1";
const FRAME: usize = super::managed_wire::FRAME;
fn read_frame(input: &mut impl BufRead) -> Result<Option<Value>, String> {
    let mut bytes = Vec::new();
    let count = Read::by_ref(input)
        .take(FRAME as u64 + 1)
        .read_until(b'\n', &mut bytes)
        .map_err(|_| "BLK-WORKFLOW-CHANNEL")?;
    if count == 0 {
        return Ok(None);
    }
    require(
        count <= FRAME && bytes.last() == Some(&b'\n'),
        "BLK-WORKFLOW-LIMIT",
    )?;
    let result = crate::strict_json::parse(&bytes)
        .map(Some)
        .map_err(|_| INVALID.to_owned());
    crate::secret_store::wipe(&mut bytes);
    result
}
fn emit(output: &mut impl Write, kind: &str, id: u64, value: Value) -> Result<(), String> {
    let mut bytes =
        serde_json::to_vec(&json!({"schemaVersion":WIRE,"type":kind,"requestId":id,"value":value}))
            .map_err(|_| INVALID)?;
    let result = (|| {
        require(bytes.len() < FRAME, "BLK-WORKFLOW-LIMIT")?;
        bytes.push(b'\n');
        output
            .write_all(&bytes)
            .and_then(|_| output.flush())
            .map_err(|_| "BLK-WORKFLOW-CHANNEL".into())
    })();
    crate::secret_store::wipe(&mut bytes);
    result
}
pub(crate) fn open_task(store: &Store, initial: &Value) -> Result<(super::Lease, Value), String> {
    keys(
        &initial,
        &["schemaVersion", "definition", "initial"],
        &["taskId"],
    )?;
    require(initial["schemaVersion"] == WIRE, INVALID)?;
    protocol::definition(&initial["definition"])?;
    protocol::bounded(&initial["initial"], protocol::STATE_LIMIT)?;
    let task = match initial.get("taskId") {
        Some(id) => {
            let id = id.as_str().ok_or(INVALID)?;
            require(protocol::stable(id), INVALID)?;
            id.to_owned()
        }
        None => format!("task-{}", uuid::Uuid::new_v4()),
    };
    let mut record = if initial.get("taskId").is_some() {
        store.task_summary(
            initial["definition"]["projectId"].as_str().ok_or(INVALID)?,
            &task,
        )?;
        store.read(&task)?
    } else {
        store.create(&task, &initial["definition"], initial["initial"].clone())?
    };
    let mut lease = store.acquire(
        &task,
        &initial["definition"],
        record["revision"].as_u64().ok_or(INVALID)?,
    )?;
    // A task ID is an explicit resume request. Business approval remains a separate operation.
    if record["status"] == "paused" {
        record = lease.commit(&json!({"kind":"resume","revision":record["revision"]}))?;
    }
    Ok((lease, record))
}
pub(crate) fn runtime_action(action: &Value) -> Result<(), String> {
    require(
        matches!(
            action["kind"].as_str(),
            Some(
                "begin"
                    | "complete"
                    | "checkpoint"
                    | "await-approval"
                    | "finish"
                    | "pause"
                    | "skip"
                    | "uncertain"
            )
        ),
        INVALID,
    )
}
pub fn serve(root: PathBuf, input: impl Read + Send + 'static, output: &mut impl Write) -> i32 {
    let (send, receive) = sync_channel(1);
    std::thread::spawn(move || {
        let mut input = BufReader::new(input);
        loop {
            let next = read_frame(&mut input);
            let terminal = !matches!(next, Ok(Some(_)));
            if send.send(next).is_err() || terminal {
                break;
            }
        }
    });
    let deadline = Instant::now() + Duration::from_secs(180);
    let next = || {
        receive
            .recv_timeout(deadline.saturating_duration_since(Instant::now()))
            .map_err(|_| "BLK-WORKFLOW-CHANNEL".to_owned())?
            .and_then(|v| v.ok_or("BLK-WORKFLOW-CHANNEL".into()))
    };
    let mut last = 0;
    let outcome = (|| {
        let initial = next()?;
        let store = Store::new(root)?;
        let (mut lease, mut record) = open_task(&store, &initial)?;
        let task = record["taskId"].as_str().ok_or(INVALID)?.to_owned();
        emit(output, "ready", 0, record.clone())?;
        loop {
            let request = next()?;
            let operation = request["operation"].as_str().ok_or(INVALID)?;
            keys(
                &request,
                if operation == "commit" {
                    &["operation", "requestId", "action"][..]
                } else {
                    &["operation", "requestId"][..]
                },
                &[],
            )?;
            let id = request["requestId"].as_u64().ok_or(INVALID)?;
            require(id == last + 1 && id <= 1024, INVALID)?;
            last = id;
            match operation {
                "read" => emit(output, "result", id, store.read(&task)?)?,
                "commit" => {
                    runtime_action(&request["action"])?;
                    record = lease.commit(&request["action"])?;
                    emit(output, "result", id, record.clone())?;
                }
                "close" => {
                    let released = record.get("active").is_none();
                    if released {
                        lease.release()?;
                    } else {
                        drop(lease);
                    }
                    emit(output, "closed", id, json!({"released":released}))?;
                    return Ok::<(), String>(());
                }
                _ => return Err(INVALID.into()),
            }
        }
    })();
    match outcome {
        Ok(()) => 0,
        Err(code) => {
            let _ = emit(output, "error", last, json!({"code":code}));
            3
        }
    }
}
pub fn main() -> i32 {
    match crate::profile::cli_root() {
        Ok(root) => serve(
            root.join("workflow"),
            std::io::stdin(),
            &mut std::io::stdout(),
        ),
        Err(_) => {
            let _ = emit(
                &mut std::io::stdout(),
                "error",
                0,
                json!({"code":"BLK-WORKFLOW-STORE"}),
            );
            3
        }
    }
}
