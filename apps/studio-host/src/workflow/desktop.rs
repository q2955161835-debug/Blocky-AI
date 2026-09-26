//! One main-window Runtime session. Private state never crosses the WebView boundary.
use super::{
    desktop_run,
    managed_wire::FRAME,
    protocol::{keys, require},
};
use serde_json::Value;
use std::{
    path::PathBuf,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
        mpsc,
    },
};
pub(super) const ERROR: &str = "BLK-RUN-SERVICE";
pub(super) type Message = (bool, Result<Option<Value>, String>);
struct Active {
    id: String,
    send: mpsc::SyncSender<Message>,
    cancelled: Arc<AtomicBool>,
}
struct Session {
    token: String,
    capsule: Option<String>,
    poisoned: bool,
    active: Option<Active>,
}
#[derive(Default)]
struct State {
    session: Option<Session>,
    shutting_down: bool,
}
pub struct RuntimeHost {
    root: PathBuf,
    state: Mutex<State>,
}
impl RuntimeHost {
    pub fn new(root: PathBuf) -> Self {
        Self {
            root,
            state: Mutex::new(State::default()),
        }
    }
    pub fn open(&self) -> Result<String, String> {
        let mut state = self.state.lock().map_err(|_| ERROR)?;
        require(
            !state.shutting_down && state.session.as_ref().is_none_or(|s| s.active.is_none()),
            ERROR,
        )?;
        let token = format!("runtime-{}", uuid::Uuid::new_v4());
        state.session = Some(Session {
            token: token.clone(),
            capsule: None,
            poisoned: false,
            active: None,
        });
        Ok(token)
    }
    pub fn request(&self, token: &str, run: &str, message: Value) -> Result<(), String> {
        require(message.to_string().len() < FRAME, ERROR)?;
        let state = self.state.lock().map_err(|_| ERROR)?;
        let session = state
            .session
            .as_ref()
            .filter(|s| s.token == token)
            .ok_or(ERROR)?;
        let active = session
            .active
            .as_ref()
            .filter(|s| s.id == run)
            .ok_or(ERROR)?;
        if message["kind"] == "cancel" {
            keys(&message, &["kind"], &[])?;
            active.cancelled.store(true, Ordering::SeqCst);
            return Ok(());
        }
        match message["kind"].as_str() {
            Some("control") => {
                keys(&message, &["kind", "action"], &[])?;
                require(
                    matches!(
                        message["action"].as_str(),
                        Some("pause" | "resume" | "step")
                    ),
                    ERROR,
                )?;
            }
            Some("reply") => {
                keys(&message, &["kind", "id", "ok", "value"], &[])?;
                require(message["id"].is_u64() && message["ok"].is_boolean(), ERROR)?;
            }
            Some("settled") => {
                keys(&message, &["kind", "ok"], &[])?;
                require(message["ok"].is_boolean(), ERROR)?;
            }
            _ => return Err(ERROR.into()),
        }
        active
            .send
            .try_send((false, Ok(Some(message))))
            .map_err(|_| ERROR.into())
    }
    pub fn run(
        &self,
        token: &str,
        run: &str,
        mut request: Value,
        emit: impl Fn(Value) -> Result<(), String>,
    ) -> Result<Value, String> {
        // The renderer cannot import a capsule or select an executable/profile.
        keys(
            &request,
            &[
                "schemaVersion",
                "project",
                "interactionId",
                "question",
                "options",
            ],
            &[],
        )?;
        require(
            request["schemaVersion"] == "blocky.desktop-run/v1"
                && request.to_string().len() < FRAME
                && super::protocol::stable(run),
            ERROR,
        )?;
        let project = request["project"]["manifest"]["projectId"]
            .as_str()
            .ok_or(ERROR)?
            .to_owned();
        let (send, receive) = mpsc::sync_channel(8);
        let cancelled = Arc::new(AtomicBool::new(false));
        {
            let mut state = self.state.lock().map_err(|_| ERROR)?;
            require(!state.shutting_down, ERROR)?;
            let session = state
                .session
                .as_mut()
                .filter(|s| s.token == token)
                .ok_or(ERROR)?;
            require(!session.poisoned && session.active.is_none(), ERROR)?;
            if let Some(capsule) = session.capsule.take() {
                request["state"] = Value::String(capsule);
            }
            session.active = Some(Active {
                id: run.into(),
                send: send.clone(),
                cancelled: cancelled.clone(),
            });
        }
        let outcome = emit(serde_json::json!({"kind":"ready"})).and_then(|_| {
            desktop_run::run(
                &self.root, &project, request, send, receive, cancelled, emit,
            )
        });
        let mut state = self.state.lock().map_err(|_| ERROR)?;
        let session = state
            .session
            .as_mut()
            .filter(|s| s.token == token)
            .ok_or(ERROR)?;
        session.active = None;
        match outcome {
            Ok((result, capsule)) => {
                session.capsule = Some(capsule);
                Ok(result)
            }
            Err(code) => {
                session.poisoned = true;
                Err(code)
            }
        }
    }
    pub fn close(&self, token: &str) -> Result<(), String> {
        let mut state = self.state.lock().map_err(|_| ERROR)?;
        let session = state
            .session
            .as_ref()
            .filter(|s| s.token == token)
            .ok_or(ERROR)?;
        if let Some(active) = &session.active {
            active.cancelled.store(true, Ordering::SeqCst);
            return Err(ERROR.into());
        }
        state.session = None;
        Ok(())
    }
    pub fn shutdown(&self) -> Result<(), String> {
        let mut state = self.state.lock().map_err(|_| ERROR)?;
        state.shutting_down = true;
        if let Some(active) = state.session.as_ref().and_then(|s| s.active.as_ref()) {
            active.cancelled.store(true, Ordering::SeqCst);
            return Err(ERROR.into());
        }
        state.session = None;
        Ok(())
    }
}
