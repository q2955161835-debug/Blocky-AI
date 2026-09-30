use super::*;
use crate::process_worker::{IsolatedLaunch, Worker};

use std::{
    ffi::OsString,
    fs::File,
    io::Read,
    net::TcpListener,
    thread::JoinHandle,
    time::{Duration, Instant},
};
pub(crate) struct LocalSession {
    worker: Worker,
    reader: Option<JoinHandle<()>>,
    pub endpoint: String,
    pub key: Vec<u8>,
    _files: Vec<File>,
    _lock: File,
}
impl LocalSession {
    pub fn start(
        root: &Path,
        id: &str,
        options: &LocalOptions,
        cancel: &AtomicBool,
    ) -> Result<Self, String> {
        options.validate()?;
        let lock = store::guard(root)?;
        let (directory, backend, files) = store::verify_open(root, id, cancel)?;
        if backend.id != options.backend {
            return Err("BLK-LOCAL-MODEL-BACKEND".into());
        }
        let runtime = directory.join("runtime").canonicalize().map_err(|_| IO)?;
        let model = directory
            .join("model.gguf")
            .canonicalize()
            .map_err(|_| IO)?;
        // A per-launch key plus authenticated model identity distinguishes our child from a port race.
        let reservation = TcpListener::bind("127.0.0.1:0").map_err(|_| IO)?;
        let port = reservation.local_addr().map_err(|_| IO)?.port();
        let key = format!(
            "{}{}",
            uuid::Uuid::new_v4().simple(),
            uuid::Uuid::new_v4().simple()
        );
        let mut environment = vec![(OsString::from("LLAMA_API_KEY"), OsString::from(&key))];
        if let Some(system) = std::env::var_os("SystemRoot") {
            environment.push(("SystemRoot".into(), system));
        }
        let args = [
            "--host",
            "127.0.0.1",
            "--port",
            &port.to_string(),
            "--alias",
            MODEL_ID,
            "--jinja",
            "--no-webui",
            "--no-agent",
            "--no-webui-mcp-proxy",
            "--cors-origins",
            "https://blocky.invalid",
            "--no-cors-credentials",
            "--ctx-size",
            &options.context_tokens.to_string(),
            "--parallel",
            "1",
            "--threads",
            &options.threads.to_string(),
            "--n-gpu-layers",
            if options.backend == "cpu" { "0" } else { "99" },
            "--reasoning",
            "off",
            "--log-disable",
        ];
        let mut args: Vec<OsString> = args.into_iter().map(OsString::from).collect();
        args.push("-m".into());
        args.push(model.into_os_string());
        if let Some(device) = &options.device {
            args.extend(["--device".into(), device.into()]);
        }
        let mut worker = Worker::spawn_isolated(
            &runtime.join("llama-server.exe"),
            &args,
            &format!("Local\\BlockyModel-{}", uuid::Uuid::new_v4().simple()),
            IsolatedLaunch {
                environment: &environment,
                directory: &runtime,
                memory_limit: options.memory_mb as usize * 1024 * 1024,
            },
        )?;
        drop(environment);
        let mut output = worker.take_output().ok_or(IO)?;
        let reader = std::thread::spawn(move || {
            let mut buffer = [0u8; 8192];
            while output.read(&mut buffer).is_ok_and(|n| n > 0) {}
        });
        drop(reservation);
        let mut session = Self {
            worker,
            reader: Some(reader),
            endpoint: format!("http://127.0.0.1:{port}/v1/chat/completions"),
            key: key.into_bytes(),
            _files: files,
            _lock: lock,
        };
        if let Err(error) = session.worker.resume() {
            session.close()?;
            return Err(error);
        }
        let client = reqwest::blocking::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_millis(500))
            .build()
            .map_err(|_| IO)?;
        let began = Instant::now();
        let ready = (|| {
            loop {
                artifacts::cancelled(cancel)?;
                if !session.worker.identity().is_alive().map_err(|_| IO)? {
                    return Err("BLK-LOCAL-MODEL-START".into());
                }
                if began.elapsed() > Duration::from_secs(60) {
                    return Err("BLK-LOCAL-MODEL-TIMEOUT".into());
                }
                if let Ok(mut response) = client
                    .get(format!("http://127.0.0.1:{port}/v1/models"))
                    .bearer_auth(std::str::from_utf8(&session.key).map_err(|_| IO)?)
                    .send()
                {
                    if response.status().is_success() {
                        let mut bytes = Vec::new();
                        response
                            .by_ref()
                            .take(65537)
                            .read_to_end(&mut bytes)
                            .map_err(|_| IO)?;
                        if bytes.len() > 65536 {
                            return Err("BLK-LOCAL-MODEL-IDENTITY".into());
                        }
                        let value = crate::strict_json::parse(&bytes)
                            .map_err(|_| "BLK-LOCAL-MODEL-IDENTITY")?;
                        if value["data"]
                            .as_array()
                            .is_none_or(|a| a.len() != 1 || a[0]["id"] != MODEL_ID)
                        {
                            return Err("BLK-LOCAL-MODEL-IDENTITY".into());
                        }
                        return Ok(());
                    }
                }
                std::thread::sleep(Duration::from_millis(30));
            }
        })();
        if let Err(error) = ready {
            session.close()?;
            return Err(error);
        }
        Ok(session)
    }
    pub fn close(&mut self) -> Result<(), String> {
        let stopped = self.worker.stop();
        if stopped.is_ok() {
            if let Some(reader) = self.reader.take() {
                reader.join().map_err(|_| IO)?;
            }
        }
        crate::secret_store::wipe(&mut self.key);
        stopped.map_err(|_| "BLK-LOCAL-MODEL-UNSETTLED".into())
    }
}
impl Drop for LocalSession {
    fn drop(&mut self) {
        let _ = self.close();
    }
}

#[cfg(test)]
mod runtime_tests {
    use super::*;
    fn fixture() -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../try/agent-capability-upgrade/managed-profile")
            .canonicalize()
            .expect("Prepare the managed-profile fixture by installing the locked CPU model")
    }
    #[test]
    #[ignore = "requires the installed locked Qwen CPU fixture in try/agent-capability-upgrade/managed-profile"]
    fn managed_runtime_reaps_process_closes_port_and_releases_artifact_locks() {
        let root = fixture();
        let mut session = LocalSession::start(
            &root,
            MODEL_ID,
            &LocalOptions::default(),
            &AtomicBool::new(false),
        )
        .unwrap();
        let port = reqwest::Url::parse(&session.endpoint)
            .unwrap()
            .port()
            .unwrap();
        assert!(session.worker.identity().is_alive().unwrap());
        assert!(std::net::TcpStream::connect(("127.0.0.1", port)).is_ok());
        assert_eq!(store::guard(&root).unwrap_err(), "BLK-LOCAL-MODEL-BUSY");
        session.close().unwrap();
        assert!(!session.worker.identity().is_alive().unwrap());
        drop(session);
        assert!(std::net::TcpStream::connect(("127.0.0.1", port)).is_err());
        assert!(store::guard(&root).is_ok());
    }
    #[test]
    #[ignore = "requires the installed locked Qwen CPU fixture in try/agent-capability-upgrade/managed-profile"]
    fn managed_deadline_and_shutdown_interrupt_hashing_without_leaving_busy_state() {
        use crate::provider::{ProviderHost, gateway::GatewayRequest};
        use serde_json::json;
        let root = fixture();
        let request = |id: &str, timeout| {
            serde_json::from_value::<GatewayRequest>(json!({"schemaVersion":"blocky.model-request/v2","requestId":id,"projectId":"public-probe","resourceId":"managed-test","messages":[{"role":"user","content":"hello"}],"maxOutputTokens":64,"timeoutMs":timeout})).unwrap()
        };
        let host = ProviderHost::default();
        let r = request("deadline-probe", 10);
        let p = host.model_preflight(&root, &r).unwrap();
        let began = Instant::now();
        assert_eq!(
            host.model_call(root.clone(), r, p["requestDigest"].as_str().unwrap())
                .unwrap_err(),
            "BLK-PROVIDER-TIMEOUT"
        );
        assert!(began.elapsed() < Duration::from_secs(1));
        let r = request("shutdown-probe", 120000);
        let p = host.model_preflight(&root, &r).unwrap();
        let other = host.clone();
        let path = root.clone();
        let call = std::thread::spawn(move || {
            other.model_call(path, r, p["requestDigest"].as_str().unwrap())
        });
        std::thread::sleep(Duration::from_millis(100));
        let began = Instant::now();
        host.shutdown().unwrap();
        assert!(began.elapsed() < Duration::from_secs(2));
        assert_eq!(call.join().unwrap().unwrap_err(), "BLK-PROVIDER-CANCELLED");
        assert!(store::guard(&root).is_ok());
    }
}
