//! Desktop-owned ledger leases. No external-effect settlement is inferred here.
use super::{
    Lease, Store,
    protocol::{INVALID, keys, require},
    session,
};
use serde_json::{Value, json};
use std::{
    path::PathBuf,
    sync::Mutex,
    time::{Duration, Instant},
};

struct Session {
    token: String,
    record: Value,
    lease: Lease,
    expires: Instant,
    cancelled: bool,
    requests: u32,
}
#[derive(Default)]
struct State {
    session: Option<Session>,
    shutting_down: bool,
}
pub struct WorkflowHost {
    root: PathBuf,
    state: Mutex<State>,
}
impl WorkflowHost {
    pub fn new(root: PathBuf) -> Self {
        Self {
            root,
            state: Mutex::new(State::default()),
        }
    }
    pub fn open(&self, initial: &Value) -> Result<Value, String> {
        let mut state = self.state.lock().map_err(|_| "BLK-WORKFLOW-CHANNEL")?;
        require(!state.shutting_down, "BLK-WORKFLOW-CANCELLED")?;
        require(state.session.is_none(), "BLK-WORKFLOW-OWNER")?;
        let store = Store::new(self.root.clone())?;
        let (lease, record) = session::open_task(&store, initial)?;
        let token = format!("session-{}", uuid::Uuid::new_v4());
        let response = json!({"sessionId":token,"record":record});
        state.session = Some(Session {
            token,
            record,
            lease,
            expires: Instant::now() + Duration::from_secs(180),
            cancelled: false,
            requests: 0,
        });
        Ok(response)
    }
    pub fn request(&self, request: &Value) -> Result<Value, String> {
        let operation = request["operation"].as_str().ok_or(INVALID)?;
        keys(
            request,
            &["sessionId", "projectId", "operation"],
            if operation == "commit" {
                &["action"]
            } else {
                &[]
            },
        )?;
        require(
            matches!(operation, "read" | "commit" | "cancel" | "close"),
            INVALID,
        )?;
        let mut state = self.state.lock().map_err(|_| "BLK-WORKFLOW-CHANNEL")?;
        let current = state.session.as_mut().ok_or("BLK-WORKFLOW-BINDING")?;
        require(
            request["sessionId"] == current.token
                && request["projectId"] == current.record["definition"]["projectId"],
            "BLK-WORKFLOW-BINDING",
        )?;
        if operation == "close" {
            return close(state.session.take().ok_or("BLK-WORKFLOW-BINDING")?);
        }
        if operation == "cancel" {
            current.cancelled = true;
            return Ok(Value::Null);
        }
        let settlement = operation == "commit"
            && matches!(
                request["action"]["kind"].as_str(),
                Some("complete" | "uncertain" | "pause")
            );
        require(
            settlement || (!current.cancelled && Instant::now() < current.expires),
            "BLK-WORKFLOW-CANCELLED",
        )?;
        require(current.requests < 1024, "BLK-WORKFLOW-LIMIT")?;
        current.requests += 1;
        if operation == "commit" {
            session::runtime_action(&request["action"])?;
            current.record = current.lease.commit(&request["action"])?;
        }
        Ok(current.record.clone())
    }
    pub fn query(&self, request: &Value) -> Result<Value, String> {
        super::query::dispatch(self.root.clone(), request)
    }
    pub fn decide(&self, request: &Value) -> Result<Value, String> {
        super::decision::dispatch(self.root.clone(), request)
    }
    pub fn shutdown(&self) -> Result<(), String> {
        let mut state = self.state.lock().map_err(|_| "BLK-WORKFLOW-CHANNEL")?;
        state.shutting_down = true;
        if let Some(session) = state.session.take() {
            close(session)?;
        }
        Ok(())
    }
}
fn close(session: Session) -> Result<Value, String> {
    let released = session.record.get("active").is_none();
    if released {
        session.lease.release()?;
    }
    // An active intent keeps its native owner even after the OS lease lock is dropped.
    Ok(json!({"released":released}))
}
