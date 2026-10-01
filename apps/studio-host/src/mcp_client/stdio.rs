//! MCP pipes for a single AppContainer process. Paths originate in the native
//! registered bundle, never in a model request. Pipe readers have fixed bounds.
use super::Transport;
use crate::{
    process_worker::{IsolatedLaunch, Worker},
    tool_sandbox::Sandbox,
};
use serde_json::{json, Value};
use std::{
    ffi::OsString,
    io::{BufRead, BufReader, Read, Write},
    path::Path,
    sync::{
        mpsc::{self, Receiver, SyncSender},
        Arc, Mutex,
    },
    thread::JoinHandle,
    time::{Duration, Instant},
};
const FRAME: usize = 262144;
type WriteTask = (Vec<u8>, SyncSender<Result<(), String>>);
pub(crate) struct StdioTransport {
    worker: Worker,
    sandbox: Sandbox,
    directory: Option<tempfile::TempDir>,
    input: Option<SyncSender<WriteTask>>,
    output: Receiver<Value>,
    fault: Arc<Mutex<Option<String>>>,
    threads: Vec<JoinHandle<()>>,
    timeout: Duration,
    closed: bool,
}
fn fail(fault: &Mutex<Option<String>>, code: &str) {
    if let Ok(mut f) = fault.lock() {
        if f.is_none() {
            *f = Some(code.into());
        }
    }
}
impl StdioTransport {
    pub(crate) fn spawn_tracked(
        directory:tempfile::TempDir,executable:&Path,args:&[OsString],timeout_ms:u64,
        may_have_started:&std::sync::atomic::AtomicBool,
    )->Result<Self,String>{
        if !(1..=120000).contains(&timeout_ms) {
            return Err("BLK-MCP-LIMIT".into());
        }
        let bundle = directory.path().join("bundle");
        let work = directory.path().join("work");
        if !executable
            .canonicalize()
            .map_err(|_| "BLK-MCP-CONFIG")?
            .starts_with(bundle.canonicalize().map_err(|_| "BLK-MCP-CONFIG")?)
        {
            return Err("BLK-MCP-CONFIG".into());
        }
        std::fs::create_dir(&work).map_err(|_| "BLK-MCP-CONFIG")?;
        let mut sandbox = Sandbox::new(&directory)?;
        let prepared = (|| {
            sandbox.grant_tree(&bundle, false)?;
            sandbox.grant_tree(&work, true)?;
            let mut env: Vec<(OsString, OsString)> = [
                "SYSTEMROOT",
                "SYSTEMDRIVE",
                "USERPROFILE",
                "LOCALAPPDATA",
                "APPDATA",
            ]
            .into_iter()
            .filter_map(|key| std::env::var_os(key).map(|v| (key.into(), v)))
            .collect();
            env.extend([
                ("TEMP".into(), work.as_os_str().into()),
                ("TMP".into(), work.as_os_str().into()),
            ]);
            Worker::spawn_sandboxed(
                executable,
                args,
                &format!("Local\\BlockyMcp-{}", uuid::Uuid::new_v4()),
                IsolatedLaunch {
                    environment: &env,
                    directory: &work,
                    memory_limit: 512 * 1024 * 1024,
                },
                sandbox.sid(),
            )
        })();
        let mut worker = match prepared {
            Ok(w) => w,
            Err(error) => {
                sandbox.close()?;
                return Err(error);
            }
        };
        let stdout = worker.take_output().ok_or("BLK-MCP-PIPE")?;
        let stderr = worker.take_error().ok_or("BLK-MCP-PIPE")?;
        let mut stdin = worker.take_input().ok_or("BLK-MCP-PIPE")?;
        let (send, output) = mpsc::sync_channel(8);
        let fault = Arc::new(Mutex::new(None));
        let reader_fault = fault.clone();
        let reader = std::thread::spawn(move || {
            let mut reader = BufReader::new(stdout);
            loop {
                let mut bytes = Vec::new();
                let read = (&mut reader)
                    .take((FRAME + 1) as u64)
                    .read_until(b'\n', &mut bytes);
                match read {
                    Ok(0) => {
                        fail(&reader_fault, "BLK-MCP-CLOSED");
                        break;
                    }
                    Ok(_) if bytes.len() <= FRAME && bytes.last() == Some(&b'\n') => {}
                    Ok(_) => {
                        fail(&reader_fault, "BLK-MCP-LIMIT");
                        break;
                    }
                    Err(_) => {
                        fail(&reader_fault, "BLK-MCP-PIPE");
                        break;
                    }
                }
                let value = match crate::strict_json::parse(&bytes) {
                    Ok(v) => v,
                    Err(_) => {
                        fail(&reader_fault, "BLK-MCP-PROTOCOL");
                        break;
                    }
                };
                if super::validation::bounded(&value, FRAME).is_err() {
                    fail(&reader_fault, "BLK-MCP-LIMIT");
                    break;
                }
                if send.try_send(value).is_err() {
                    fail(&reader_fault, "BLK-MCP-LIMIT");
                    break;
                }
            }
        });
        let error_fault = fault.clone();
        let errors = std::thread::spawn(move || {
            let mut count = 0;
            let mut stderr = stderr;
            let mut bytes = [0u8; 4096];
            loop {
                match stderr.read(&mut bytes) {
                    Ok(0) => break,
                    Ok(n) => {
                        count += n;
                        if count > 1024 * 1024 {
                            fail(&error_fault, "BLK-MCP-LIMIT");
                            break;
                        }
                    }
                    Err(_) => break,
                }
            }
        });
        let (input, receive) = mpsc::sync_channel::<WriteTask>(2);
        let writer = std::thread::spawn(move || {
            while let Ok((bytes, done)) = receive.recv() {
                let result = stdin
                    .write_all(&bytes)
                    .and_then(|_| stdin.flush())
                    .map_err(|_| "BLK-MCP-PIPE".into());
                let failed = result.is_err();
                let _ = done.send(result);
                if failed {
                    break;
                }
            }
        });
        let mut session = Self {
            worker,
            sandbox,
            directory: Some(directory),
            input: Some(input),
            output,
            fault,
            threads: vec![reader, errors, writer],
            timeout: Duration::from_millis(timeout_ms),
            closed: false,
        };
        // The suspended worker cannot execute server initialization beforehand.
        // Set conservatively before resume, including an uncertain resume error.
        may_have_started.store(true,std::sync::atomic::Ordering::SeqCst);
        if let Err(error) = session.worker.resume() {
            session.close()?;
            return Err(error);
        }
        Ok(session)
    }
    fn check(&self, start: Instant, cancel: &dyn Fn() -> Result<(), String>) -> Result<(), String> {
        cancel()?;
        if self.closed {
            return Err("BLK-MCP-CLOSED".into());
        }
        if start.elapsed() >= self.timeout {
            return Err("BLK-MCP-TIMEOUT".into());
        }
        if let Some(code) = self.fault.lock().map_err(|_| "BLK-MCP-PIPE")?.clone() {
            return Err(code);
        }
        Ok(())
    }
    fn write(
        &self,
        message: &Value,
        start: Instant,
        cancel: &dyn Fn() -> Result<(), String>,
    ) -> Result<(), String> {
        super::validation::bounded(message, FRAME - 1)?;
        let mut bytes = serde_json::to_vec(message).map_err(|_| "BLK-MCP-PROTOCOL")?;
        bytes.push(b'\n');
        let (done, receive) = mpsc::sync_channel(1);
        self.input
            .as_ref()
            .ok_or("BLK-MCP-CLOSED")?
            .try_send((bytes, done))
            .map_err(|_| "BLK-MCP-PIPE")?;
        loop {
            self.check(start, cancel)?;
            match receive.recv_timeout(Duration::from_millis(10)) {
                Ok(result) => return result,
                Err(mpsc::RecvTimeoutError::Timeout) => {}
                Err(_) => return Err("BLK-MCP-PIPE".into()),
            }
        }
    }
    fn request(
        &mut self,
        message: &Value,
        cancel: &dyn Fn() -> Result<(), String>,
    ) -> Result<Option<Value>, String> {
        let start = Instant::now();
        self.check(start, cancel)?;
        self.write(message, start, cancel)?;
        let Some(id) = message.get("id") else {
            return Ok(None);
        };
        let mut count = 0;
        let mut bytes = 0;
        loop {
            self.check(start, cancel)?;
            let reply = match self.output.recv_timeout(Duration::from_millis(10)) {
                Ok(v) => v,
                Err(mpsc::RecvTimeoutError::Timeout) => continue,
                Err(_) => {
                    return Err(self
                        .fault
                        .lock()
                        .map_err(|_| "BLK-MCP-PIPE")?
                        .clone()
                        .unwrap_or_else(|| "BLK-MCP-CLOSED".into()))
                }
            };
            count += 1;
            bytes += serde_json::to_vec(&reply)
                .map_err(|_| "BLK-MCP-PROTOCOL")?
                .len();
            if count > 64 || bytes > 1024 * 1024 {
                return Err("BLK-MCP-LIMIT".into());
            }
            if !reply.is_object() || reply["jsonrpc"] != "2.0" {
                return Err("BLK-MCP-PROTOCOL".into());
            }
            if reply.get("method").is_some() {
                if reply["method"].as_str().is_none()
                    || reply.get("result").is_some()
                    || reply.get("error").is_some()
                {
                    return Err("BLK-MCP-PROTOCOL".into());
                }
                if let Some(server_id) = reply.get("id") {
                    if !server_id.is_u64() && !server_id.as_str().is_some_and(|s| s.len() <= 128) {
                        return Err("BLK-MCP-PROTOCOL".into());
                    }
                    self.write(&json!({"jsonrpc":"2.0","id":server_id,"error":{"code":-32601,"message":"Client capability unavailable"}}),start,cancel)?;
                }
                continue;
            }
            if reply.get("id") != Some(id) {
                return Err("BLK-MCP-PROTOCOL".into());
            }
            return Ok(Some(reply));
        }
    }
}
impl Transport for StdioTransport {
    fn exchange(
        &mut self,
        message: &Value,
        cancel: &dyn Fn() -> Result<(), String>,
    ) -> Result<Option<Value>, String> {
        let result = self.request(message, cancel);
        if result.is_err() {
            self.close()?;
        }
        result
    }
    fn negotiated(&mut self, _version: &str) -> Result<(), String> {
        Ok(())
    }
    fn close(&mut self) -> Result<(), String> {
        if self.closed {
            return Ok(());
        }
        self.input.take();
        self.worker.stop()?;
        for thread in self.threads.drain(..) {
            thread.join().map_err(|_| "BLK-MCP-PIPE")?;
        }
        self.sandbox.close()?;
        if let Some(directory) = self.directory.take() {
            directory.close().map_err(|_| "BLK-TOOL-CLEANUP")?;
        }
        self.closed = true;
        Ok(())
    }
}
impl Drop for StdioTransport {
    fn drop(&mut self) {
        let _ = self.close();
    }
}
#[cfg(test)]
#[path = "stdio_tests.rs"]
mod tests;
