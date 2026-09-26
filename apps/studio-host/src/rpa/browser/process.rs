use serde_json::{Value, json};
use std::{
    io::{BufRead, BufReader, Read, Write},
    path::Path,
    process::{Child, ChildStdin, Command, Stdio},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
        mpsc::{self, Receiver},
    },
    thread::JoinHandle,
    time::{Duration, Instant},
};
const WIRE: &str = "BLK-RPA-WIRE-001";
fn wait_child(child: &mut Child) -> bool {
    let started = Instant::now();
    loop {
        if child.try_wait().ok().flatten().is_some() {
            return true;
        }
        if started.elapsed() >= Duration::from_millis(500) {
            return false;
        }
        std::thread::sleep(Duration::from_millis(5));
    }
}
pub(super) fn join_bounded<T>(
    handle: JoinHandle<T>,
    cancel: bool,
) -> Option<std::thread::Result<T>> {
    use std::os::windows::io::AsRawHandle;
    let started = Instant::now();
    while !handle.is_finished() {
        if cancel {
            unsafe {
                windows_sys::Win32::System::IO::CancelSynchronousIo(handle.as_raw_handle() as _);
            }
        }
        if started.elapsed() >= Duration::from_millis(500) {
            return None;
        }
        std::thread::sleep(Duration::from_millis(5));
    }
    Some(handle.join())
}
pub(crate) struct BrowserProcess {
    child: Child,
    job: crate::process_job::Job,
    stdin: Option<Arc<Mutex<ChildStdin>>>,
    replies: Receiver<Result<Value, String>>,
    reader: Option<JoinHandle<()>>,
    sequence: u64,
    dead: bool,
    settled: bool,
    _temporary: Option<tempfile::TempDir>,
}
impl BrowserProcess {
    pub(crate) fn start(root: &Path, cancel: Arc<AtomicBool>) -> Result<Self, String> {
        if cancel.load(Ordering::SeqCst) {
            return Err("BLK-RPA-CANCELLED".into());
        }
        let directory = super::assets::locate()?;
        let edge = super::assets::edge()?;
        std::fs::create_dir_all(root).map_err(|_| "BLK-RPA-RUNTIME-001")?;
        let temporary = tempfile::Builder::new()
            .prefix("browser-")
            .tempdir_in(root)
            .map_err(|_| "BLK-RPA-RUNTIME-001")?;
        let mut command = Command::new(directory.join("node.exe"));
        command
            .env_clear()
            .arg("--no-addons")
            .arg(directory.join("browser.mjs"))
            .current_dir(&directory)
            .env("TEMP", temporary.path())
            .env("TMP", temporary.path())
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        if let Some(value) = std::env::var_os("SystemRoot") {
            command.env("SystemRoot", value);
        }
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000200);
        let mut child = command.spawn().map_err(|_| "BLK-RPA-BROWSER-001")?;
        let job = match crate::process_job::attach(&child) {
            Ok(job) => job,
            Err(_) => {
                let _ = child.kill();
                if !wait_child(&mut child) {
                    let _ = temporary.keep();
                    return Err("BLK-RPA-SETTLEMENT-001".into());
                }
                return Err("BLK-RPA-BROWSER-001".into());
            }
        };
        let stdin = child.stdin.take().ok_or(WIRE)?;
        let stdout = child.stdout.take().ok_or(WIRE)?;
        let (send, replies) = mpsc::sync_channel(8);
        let reader = std::thread::spawn(move || {
            let mut reader = BufReader::new(stdout);
            loop {
                let mut line = Vec::new();
                let result = Read::take(&mut reader, 65537).read_until(b'\n', &mut line);
                if matches!(result, Ok(0)) {
                    break;
                }
                let value = if result.is_err() || line.len() > 65536 || !line.ends_with(b"\n") {
                    Err(WIRE.into())
                } else {
                    crate::strict_json::parse(&line).map_err(|_| WIRE.into())
                };
                let invalid = value.is_err();
                if send.try_send(value).is_err() || invalid {
                    break;
                }
            }
        });
        let mut process = Self {
            child,
            job,
            stdin: Some(Arc::new(Mutex::new(stdin))),
            replies,
            reader: Some(reader),
            sequence: 0,
            dead: false,
            settled: false,
            _temporary: Some(temporary),
        };
        let response = process.request(
            json!({"kind":"init","executablePath":edge,"artifactsPath":process._temporary.as_ref().ok_or(WIRE)?.path()}),
            20000,
            cancel,
        );
        match response {
            Ok(value) if value == json!({"ready":true}) => {}
            Ok(_) => {
                process.terminate()?;
                return Err(WIRE.into());
            }
            Err(code) => {
                process.terminate()?;
                return Err(code);
            }
        }
        Ok(process)
    }
    pub(crate) fn request(
        &mut self,
        mut value: Value,
        timeout: u64,
        cancel: Arc<AtomicBool>,
    ) -> Result<Value, String> {
        if self.dead {
            return Err("BLK-RPA-BROWSER-001".into());
        }
        if cancel.load(Ordering::SeqCst) {
            self.terminate()?;
            return Err("BLK-RPA-CANCELLED".into());
        }
        self.sequence += 1;
        value["schemaVersion"] = json!("blocky.browser-ipc/v1");
        value["requestId"] = json!(self.sequence);
        let mut bytes = serde_json::to_vec(&value).map_err(|_| WIRE)?;
        bytes.push(b'\n');
        drop(value);
        if bytes.len() > 65536 {
            self.terminate()?;
            return Err("BLK-RPA-LIMIT-001".into());
        }
        let stdin = self.stdin.as_ref().ok_or(WIRE)?.clone();
        let writer = std::thread::spawn(move || {
            let result = stdin
                .lock()
                .map_err(|_| WIRE.to_string())
                .and_then(|mut pipe| {
                    pipe.write_all(&bytes)
                        .and_then(|_| pipe.flush())
                        .map_err(|_| WIRE.to_string())
                });
            crate::secret_store::wipe(&mut bytes);
            result
        });
        let started = Instant::now();
        let received = (|| loop {
            if cancel.load(Ordering::SeqCst) {
                return Err("BLK-RPA-CANCELLED".into());
            }
            if started.elapsed() >= Duration::from_millis(timeout) {
                return Err("BLK-RPA-TIMEOUT-001".into());
            }
            match self.replies.recv_timeout(Duration::from_millis(10)) {
                Ok(frame) => break frame,
                Err(mpsc::RecvTimeoutError::Timeout) => {}
                Err(_) => return Err(WIRE.into()),
            }
        })();
        if received.is_err() {
            let settled = self.terminate();
            if join_bounded(writer, true).is_none() {
                self.settled = false;
                return Err("BLK-RPA-SETTLEMENT-001".into());
            }
            settled?;
            return received;
        }
        let written = join_bounded(writer, false);
        if written.is_none() {
            self.terminate()?;
            self.settled = false;
            return Err("BLK-RPA-SETTLEMENT-001".into());
        }
        if !written.is_some_and(|r| r.is_ok_and(|r| r.is_ok())) {
            self.terminate()?;
            return Err(WIRE.into());
        }
        let frame = received?;
        let valid = frame.as_object().is_some_and(|o| {
            o.keys().all(|k| {
                ["schemaVersion", "requestId", "ok", "value", "code"].contains(&k.as_str())
            })
        }) && frame["schemaVersion"] == "blocky.browser-ipc/v1"
            && frame["requestId"].as_u64() == Some(self.sequence)
            && frame["ok"].is_boolean();
        if !valid {
            self.terminate()?;
            return Err(WIRE.into());
        }
        if frame["ok"] == true {
            if frame.get("code").is_some() || frame.get("value").is_none() {
                self.terminate()?;
                return Err(WIRE.into());
            }
            return Ok(frame["value"].clone());
        }
        let code = frame["code"]
            .as_str()
            .filter(|c| {
                c.starts_with("BLK-RPA-")
                    && c.len() < 80
                    && c.bytes()
                        .all(|b| b.is_ascii_uppercase() || b.is_ascii_digit() || b == b'-')
            })
            .filter(|_| frame.get("value").is_none());
        if let Some(code) = code {
            Err(code.into())
        } else {
            self.terminate()?;
            Err(WIRE.into())
        }
    }
    pub(crate) fn terminate(&mut self) -> Result<(), String> {
        if self.dead {
            return if self.settled {
                Ok(())
            } else {
                Err("BLK-RPA-SETTLEMENT-001".into())
            };
        }
        self.dead = true;
        let job_settled = self.job.settle();
        let _ = self.child.kill();
        let child_exited = wait_child(&mut self.child);
        self.stdin.take();
        let reader_finished = self
            .reader
            .take()
            .is_none_or(|reader| join_bounded(reader, true).is_some_and(|r| r.is_ok()));
        self.settled = job_settled && child_exited && reader_finished;
        if self.settled {
            Ok(())
        } else {
            // Do not delete a profile while an unconfirmed process may still own it.
            if let Some(temporary) = self._temporary.take() {
                let _ = temporary.keep();
            }
            Err("BLK-RPA-SETTLEMENT-001".into())
        }
    }
    pub(crate) fn shutdown(&mut self) -> Result<(), String> {
        if self.dead {
            return self.terminate();
        }
        let response = self.request(
            json!({"kind":"shutdown"}),
            5000,
            Arc::new(AtomicBool::new(false)),
        );
        self.terminate()?;
        if response? != json!({"settled":true}) {
            return Err(WIRE.into());
        }
        Ok(())
    }
    #[cfg(test)]
    pub(super) fn child_exited(&mut self) -> bool {
        self.settled && self.child.try_wait().ok().flatten().is_some()
    }
}
impl Drop for BrowserProcess {
    fn drop(&mut self) {
        let _ = self.terminate();
    }
}
