//! User-owned ConPTY sessions. Only the trusted desktop Host may expose this API.
//! No task/agent caller discriminator or executable/argument escape hatch exists here.
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    path::Path,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
        mpsc::SyncSender,
    },
    thread::JoinHandle,
};
#[cfg(windows)]
mod native;
#[cfg(all(test, windows))]
mod tests;
const INVALID: &str = "BLK-TERM-101";
const FAILED: &str = "BLK-TERM-001";
#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Profile {
    PowerShell,
    Cmd,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub session_id: String,
    pub profile: Profile,
    pub process_id: u32,
    pub status: String,
    pub rows: u16,
    pub cols: u16,
    pub output: String,
    pub output_bytes: usize,
    pub dropped_bytes: u64,
    pub revision: u64,
    pub exit_code: Option<u32>,
}
struct Session {
    state: Arc<Mutex<Snapshot>>,
    stop: Arc<AtomicBool>,
    input: SyncSender<String>,
    console: Arc<Mutex<Option<isize>>>,
    worker: Option<JoinHandle<()>>,
}
impl Drop for Session {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(w) = self.worker.take() {
            if w.join().is_err() {
                if let Ok(mut state) = self.state.lock() {
                    state.status = "failed".into();
                }
            }
        }
    }
}
#[derive(Default)]
pub struct UserTerminals {
    sessions: Mutex<HashMap<String, Session>>,
}
fn dimensions(rows: u16, cols: u16) -> Result<(), String> {
    if !(2..=500).contains(&rows) || !(2..=1000).contains(&cols) {
        Err(INVALID.into())
    } else {
        Ok(())
    }
}
impl UserTerminals {
    pub fn create(
        &self,
        profile: Profile,
        cwd: &Path,
        output_budget: usize,
        rows: u16,
        cols: u16,
        timeout_ms: Option<u64>,
    ) -> Result<Snapshot, String> {
        dimensions(rows, cols)?;
        if !(4096..=4 * 1024 * 1024).contains(&output_budget)
            || !cwd.is_absolute()
            || !cwd.is_dir()
            || timeout_ms.is_some_and(|v| !(100..=86400000).contains(&v))
        {
            return Err(INVALID.into());
        }
        let mut sessions = self.sessions.lock().map_err(|_| FAILED)?;
        // Finished sessions stay readable until explicitly closed; capacity also bounds metadata.
        if sessions.len() >= 8 {
            return Err("BLK-TERM-102".into());
        }
        let id = uuid::Uuid::new_v4().to_string();
        let state = Arc::new(Mutex::new(Snapshot {
            session_id: id.clone(),
            profile,
            process_id: 0,
            status: "starting".into(),
            rows,
            cols,
            output: String::new(),
            output_bytes: 0,
            dropped_bytes: 0,
            revision: 0,
            exit_code: None,
        }));
        #[cfg(windows)]
        let session = native::launch(
            profile,
            cwd,
            output_budget,
            rows,
            cols,
            timeout_ms,
            state.clone(),
        )?;
        #[cfg(not(windows))]
        return Err("BLK-TERM-UNSUPPORTED".into());
        #[cfg(windows)]
        {
            let snapshot = state.lock().map_err(|_| FAILED)?.clone();
            sessions.insert(id, session);
            Ok(snapshot)
        }
    }
    pub fn read(&self, id: &str) -> Result<Snapshot, String> {
        let sessions = self.sessions.lock().map_err(|_| FAILED)?;
        Ok(sessions
            .get(id)
            .ok_or(INVALID)?
            .state
            .lock()
            .map_err(|_| FAILED)?
            .clone())
    }
    pub fn write(&self, id: &str, input: &str) -> Result<(), String> {
        if input.is_empty() || input.len() > 16384 {
            return Err(INVALID.into());
        }
        let sessions = self.sessions.lock().map_err(|_| FAILED)?;
        let s = sessions.get(id).ok_or(INVALID)?;
        if s.stop.load(Ordering::SeqCst) || s.state.lock().map_err(|_| FAILED)?.status != "running"
        {
            return Err(INVALID.into());
        }
        s.input
            .try_send(input.into())
            .map_err(|_| "BLK-TERM-103".into())
    }
    pub fn resize(&self, id: &str, rows: u16, cols: u16) -> Result<(), String> {
        dimensions(rows, cols)?;
        let sessions = self.sessions.lock().map_err(|_| FAILED)?;
        let s = sessions.get(id).ok_or(INVALID)?;
        let console = s.console.lock().map_err(|_| FAILED)?;
        let pc = console.ok_or(INVALID)?;
        #[cfg(windows)]
        native::resize(pc, rows, cols)?;
        let mut state = s.state.lock().map_err(|_| FAILED)?;
        state.rows = rows;
        state.cols = cols;
        state.revision += 1;
        Ok(())
    }
    pub fn close(&self, id: &str) -> Result<(), String> {
        let s = self
            .sessions
            .lock()
            .map_err(|_| FAILED)?
            .remove(id)
            .ok_or(INVALID)?;
        let state = s.state.clone();
        drop(s);
        if state.lock().map_err(|_| FAILED)?.status == "failed" {
            Err(FAILED.into())
        } else {
            Ok(())
        }
    }
    pub fn settle(&self) -> Result<(), String> {
        let sessions = std::mem::take(&mut *self.sessions.lock().map_err(|_| FAILED)?);
        for s in sessions.values() {
            s.stop.store(true, Ordering::SeqCst);
        }
        let states: Vec<_> = sessions.values().map(|s| s.state.clone()).collect();
        drop(sessions);
        if states
            .iter()
            .any(|s| s.lock().map_or(true, |s| s.status == "failed"))
        {
            Err(FAILED.into())
        } else {
            Ok(())
        }
    }
    pub fn active_count(&self) -> usize {
        self.sessions
            .lock()
            .map(|ss| {
                ss.values()
                    .filter(|s| s.state.lock().is_ok_and(|v| v.status == "running"))
                    .count()
            })
            .unwrap_or(0)
    }
}
/// Incremental UTF-8 decoding: an incomplete final scalar is kept for the next read.
fn append(state: &mut Snapshot, pending: &mut Vec<u8>, bytes: &[u8], budget: usize) {
    pending.extend_from_slice(bytes);
    loop {
        match std::str::from_utf8(pending) {
            Ok(text) => {
                state.output.push_str(text);
                pending.clear();
                break;
            }
            Err(e) => {
                let valid = e.valid_up_to();
                state
                    .output
                    .push_str(std::str::from_utf8(&pending[..valid]).unwrap());
                pending.drain(..valid);
                if let Some(n) = e.error_len() {
                    state.output.push('\u{fffd}');
                    pending.drain(..n);
                } else {
                    break;
                }
            }
        }
    }
    if state.output.len() > budget {
        let mut cut = state.output.len() - budget;
        while !state.output.is_char_boundary(cut) {
            cut += 1;
        }
        state.output.drain(..cut);
        state.dropped_bytes = state.dropped_bytes.saturating_add(cut as u64);
    }
    state.output_bytes = state.output.len();
    state.revision = state.revision.saturating_add(1);
}
