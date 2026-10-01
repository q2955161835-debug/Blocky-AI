//! Host-owned loopback receiver. Authentication grants no workflow authority: the
//! bounded callback must verify current grants/configuration, persist a claim, and
//! enqueue work before returning. It must never synchronously execute a workflow.
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    path::PathBuf,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
const ERROR: &str = "BLK-TRIGGER-RECEIVER";
const FRAME: usize = 65536;
const HEADER: usize = 4096;
type Consumer = Arc<dyn Fn(Event) -> Result<Value, String> + Send + Sync>;
type Alive = Arc<dyn Fn() -> bool + Send + Sync>;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Event {
    pub schema_version: String,
    pub event_id: String,
    pub source_id: String,
    pub project_id: String,
    pub trigger_id: String,
    pub revision: u64,
    pub occurred_at: u64,
    pub payload: Value,
}
fn id(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 128
        && s.as_bytes()[0].is_ascii_lowercase()
        && s.split(['.', '-', '_']).all(|p| {
            !p.is_empty()
                && p.bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
        })
}
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(u64::MAX as u128) as u64
}
impl Event {
    pub fn validate(
        &self,
        project: &str,
        source: &str,
        timestamp: u64,
    ) -> Result<(), &'static str> {
        if self.schema_version != "blocky.external-trigger-event/v1"
            || ![
                &self.event_id,
                &self.source_id,
                &self.project_id,
                &self.trigger_id,
            ]
            .into_iter()
            .all(|s| id(s))
            || self.revision == 0
            || self.revision > 9_007_199_254_740_991
            || self.occurred_at > 8_640_000_000_000_000
        {
            return Err("BLK-TRIGGER-EVENT");
        }
        if self.project_id != project || self.source_id != source {
            return Err("BLK-TRIGGER-BINDING");
        }
        if self.occurred_at < timestamp.saturating_sub(300000)
            || self.occurred_at > timestamp.saturating_add(30000)
        {
            return Err("BLK-TRIGGER-EVENT-TIME");
        }
        if serde_json::to_vec(&self.payload)
            .map_err(|_| "BLK-TRIGGER-EVENT")?
            .len()
            > 32768
        {
            return Err("BLK-TRIGGER-LIMIT");
        }
        Ok(())
    }
}
pub struct Receiver {
    /// Public metadata only; this URL never includes the bearer credential.
    pub endpoint: String,
    stop: Arc<AtomicBool>,
    worker: Option<JoinHandle<()>>,
}
impl Receiver {
    pub fn start(
        secret_root: PathBuf,
        secret_ref: String,
        project_id: String,
        source_id: String,
        consume: Consumer,
        alive: Alive,
    ) -> Result<Self, String> {
        if !crate::project_store::stable(&secret_ref) || !id(&project_id) || !id(&source_id) {
            return Err(ERROR.into());
        }
        let secrets = crate::secret_store::SecretStore::new(secret_root);
        // Verify the credential can be decrypted without exposing its bytes.
        if !secrets
            .with_secret(&secret_ref, |s| !s.is_empty())
            .map_err(|_| ERROR)?
        {
            return Err(ERROR.into());
        }
        let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0)).map_err(|_| ERROR)?;
        listener.set_nonblocking(true).map_err(|_| ERROR)?;
        let endpoint = format!(
            "http://{}/events",
            listener.local_addr().map_err(|_| ERROR)?
        );
        let stop = Arc::new(AtomicBool::new(false));
        let cancelled = stop.clone();
        let worker = thread::Builder::new()
            .name("blocky-external-receiver".into())
            .spawn(move || {
                let mut window = Instant::now();
                let mut count = 0;
                while !cancelled.load(Ordering::Acquire) && alive() {
                    match listener.accept() {
                        Ok((mut stream, peer)) => {
                            if !peer.ip().is_loopback() {
                                continue;
                            }
                            if window.elapsed() >= Duration::from_secs(1) {
                                window = Instant::now();
                                count = 0;
                            }
                            count += 1;
                            let _ = stream.set_read_timeout(Some(Duration::from_millis(100)));
                            let _ = stream.set_write_timeout(Some(Duration::from_millis(500)));
                            if count > 10 {
                                respond(&mut stream, 429, json!({"code":"BLK-TRIGGER-RATE"}));
                            } else {
                                handle(
                                    &mut stream,
                                    &secrets,
                                    &secret_ref,
                                    &project_id,
                                    &source_id,
                                    &consume,
                                    &alive,
                                    &cancelled,
                                );
                            }
                        }
                        Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {}
                        Err(_) => break,
                    }
                    thread::sleep(Duration::from_millis(20));
                }
            })
            .map_err(|_| ERROR)?;
        Ok(Self {
            endpoint,
            stop,
            worker: Some(worker),
        })
    }
    pub fn stop(&mut self) {
        self.stop.store(true, Ordering::Release);
        if let Some(worker) = self.worker.take() {
            if worker.thread().id() != thread::current().id() {
                let _ = worker.join();
            }
        }
    }
}
impl Drop for Receiver {
    fn drop(&mut self) {
        self.stop();
    }
}
struct Raw(Vec<u8>);
impl Drop for Raw {
    fn drop(&mut self) {
        crate::secret_store::wipe(&mut self.0);
    }
}
fn respond(stream: &mut TcpStream, status: u16, value: Value) {
    // Consume already-arriving bounded input before closing, so Windows does not
    // replace a safe error response with a reset due to unread request bytes.
    if status != 200 {
        let _ = stream.set_read_timeout(Some(Duration::from_millis(10)));
        let deadline = Instant::now() + Duration::from_millis(20);
        let mut buffer = [0u8; 1024];
        let mut remaining = FRAME;
        while remaining > 0 && Instant::now() < deadline {
            let capacity = remaining.min(buffer.len());
            match stream.read(&mut buffer[..capacity]) {
                Ok(0) | Err(_) => break,
                Ok(n) => remaining -= n,
            }
        }
        crate::secret_store::wipe(&mut buffer);
    }
    let body = serde_json::to_vec(&value).unwrap_or_else(|_| b"{}".to_vec());
    let reason = match status {
        200 => "OK",
        400 => "Bad Request",
        401 => "Unauthorized",
        413 => "Payload Too Large",
        429 => "Too Many Requests",
        503 => "Service Unavailable",
        _ => "Internal Server Error",
    };
    let header = format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\nCache-Control: no-store\r\n\r\n",
        body.len()
    );
    let _ = stream
        .write_all(header.as_bytes())
        .and_then(|_| stream.write_all(&body));
}
fn handle(
    stream: &mut TcpStream,
    secrets: &crate::secret_store::SecretStore,
    secret_ref: &str,
    project: &str,
    source: &str,
    consume: &Consumer,
    alive: &Alive,
    stop: &AtomicBool,
) {
    let result = receive(
        stream, secrets, secret_ref, project, source, consume, alive, stop,
    );
    match result {
        Ok(value) => respond(stream, 200, value),
        Err((status, code)) => respond(stream, status, json!({"code":code})),
    }
}
type Failure = (u16, &'static str);
fn receive(
    stream: &mut TcpStream,
    secrets: &crate::secret_store::SecretStore,
    secret_ref: &str,
    project: &str,
    source: &str,
    consume: &Consumer,
    alive: &Alive,
    stop: &AtomicBool,
) -> Result<Value, Failure> {
    let deadline = Instant::now() + Duration::from_secs(1);
    let mut raw = Raw(Vec::with_capacity(HEADER));
    let end = loop {
        if let Some(at) = raw.0.windows(4).position(|s| s == b"\r\n\r\n") {
            break at + 4;
        }
        if raw.0.len() >= HEADER {
            return Err((413, "BLK-TRIGGER-LIMIT"));
        }
        read_more(stream, &mut raw.0, HEADER, deadline, alive, stop)?;
    };
    if end > HEADER {
        return Err((413, "BLK-TRIGGER-LIMIT"));
    }
    let (length, authorized) = {
        let headers = std::str::from_utf8(&raw.0[..end]).map_err(|_| (400, "BLK-TRIGGER-HTTP"))?;
        let mut lines = headers.split("\r\n");
        if lines.next() != Some("POST /events HTTP/1.1") {
            return Err((400, "BLK-TRIGGER-HTTP"));
        }
        let mut length = None;
        let mut authorization = None;
        for line in lines.filter(|s| !s.is_empty()) {
            let (name, value) = line.split_once(':').ok_or((400, "BLK-TRIGGER-HTTP"))?;
            if name.is_empty()
                || !name.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
                || value.bytes().any(|b| b < 32 && b != 9 || b == 127)
            {
                return Err((400, "BLK-TRIGGER-HTTP"));
            }
            let value = value.trim();
            if name.eq_ignore_ascii_case("transfer-encoding") {
                return Err((400, "BLK-TRIGGER-HTTP"));
            }
            if name.eq_ignore_ascii_case("content-length") {
                if length.is_some()
                    || value.is_empty()
                    || !value.bytes().all(|b| b.is_ascii_digit())
                {
                    return Err((400, "BLK-TRIGGER-HTTP"));
                }
                length = Some(
                    value
                        .parse::<usize>()
                        .map_err(|_| (413, "BLK-TRIGGER-LIMIT"))?,
                );
            }
            if name.eq_ignore_ascii_case("authorization") {
                if authorization.is_some() {
                    return Err((400, "BLK-TRIGGER-HTTP"));
                }
                authorization = Some(
                    value
                        .strip_prefix("Bearer ")
                        .ok_or((401, "BLK-TRIGGER-AUTH"))?
                        .as_bytes(),
                );
            }
        }
        let length = length.ok_or((400, "BLK-TRIGGER-HTTP"))?;
        if length == 0 || length > FRAME - end {
            return Err((413, "BLK-TRIGGER-LIMIT"));
        }
        let token = authorization.ok_or((401, "BLK-TRIGGER-AUTH"))?;
        let authorized = secrets
            .with_secret(secret_ref, |expected| constant_time(expected, token))
            .map_err(|_| (401, "BLK-TRIGGER-AUTH"))?;
        (length, authorized)
    };
    if !authorized {
        return Err((401, "BLK-TRIGGER-AUTH"));
    }
    while raw.0.len() < end + length {
        read_more(stream, &mut raw.0, end + length, deadline, alive, stop)?;
    }
    if raw.0.len() != end + length {
        return Err((400, "BLK-TRIGGER-HTTP"));
    }
    let value = crate::strict_json::parse(&raw.0[end..]).map_err(|_| (400, "BLK-TRIGGER-EVENT"))?;
    let event: Event = serde_json::from_value(value).map_err(|_| (400, "BLK-TRIGGER-EVENT"))?;
    event
        .validate(project, source, now())
        .map_err(|e| (if e == "BLK-TRIGGER-LIMIT" { 413 } else { 400 }, e))?;
    if stop.load(Ordering::Acquire) || !alive() {
        return Err((503, "BLK-TRIGGER-INACTIVE"));
    }
    let summary = consume(event).map_err(|_| (503, "BLK-TRIGGER-CONSUME"))?;
    // Never trust callback JSON as an HTTP response: no payload/path/secret echo.
    Ok(
        json!({"accepted":true,"duplicate":summary.get("duplicate").and_then(Value::as_bool).unwrap_or(false) || summary.get("claimed").and_then(Value::as_bool) == Some(false),"queued":summary.get("queued").and_then(Value::as_bool).unwrap_or(false)}),
    )
}
fn read_more(
    stream: &mut TcpStream,
    bytes: &mut Vec<u8>,
    limit: usize,
    deadline: Instant,
    alive: &Alive,
    stop: &AtomicBool,
) -> Result<(), Failure> {
    if stop.load(Ordering::Acquire) || !alive() {
        return Err((503, "BLK-TRIGGER-INACTIVE"));
    }
    if Instant::now() >= deadline {
        return Err((400, "BLK-TRIGGER-HTTP-TIMEOUT"));
    }
    let mut buffer = [0u8; 512];
    let capacity = buffer.len().min(limit.saturating_sub(bytes.len()));
    if capacity == 0 {
        return Err((413, "BLK-TRIGGER-LIMIT"));
    }
    let result = stream.read(&mut buffer[..capacity]);
    match result {
        Ok(0) => Err((400, "BLK-TRIGGER-HTTP")),
        Ok(n) => {
            bytes.extend_from_slice(&buffer[..n]);
            crate::secret_store::wipe(&mut buffer);
            Ok(())
        }
        Err(e)
            if matches!(
                e.kind(),
                std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
            ) =>
        {
            crate::secret_store::wipe(&mut buffer);
            Ok(())
        }
        Err(_) => {
            crate::secret_store::wipe(&mut buffer);
            Err((400, "BLK-TRIGGER-HTTP"))
        }
    }
}
fn constant_time(expected: &[u8], actual: &[u8]) -> bool {
    let mut mismatch = expected.len() ^ actual.len();
    // Fixed maximum secret length, independent of credential length/content.
    for i in 0..16384 {
        mismatch |=
            (expected.get(i).copied().unwrap_or(0) ^ actual.get(i).copied().unwrap_or(0)) as usize;
    }
    mismatch == 0 && !expected.is_empty()
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicUsize;
    fn directory() -> tempfile::TempDir {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../try/agent-capability-upgrade/external-receiver-tests");
        std::fs::create_dir_all(&root).unwrap();
        tempfile::tempdir_in(root).unwrap()
    }
    fn credential(root: &std::path::Path, token: &str) {
        let env = root.join("synthetic.env");
        std::fs::write(&env, format!("KEY={token}\n")).unwrap();
        crate::secret_store::SecretStore::new(root.join("secrets"))
            .import_env("external-test", &env, "KEY")
            .unwrap();
        std::fs::remove_file(env).unwrap();
    }
    fn body() -> Value {
        json!({"schemaVersion":"blocky.external-trigger-event/v1","eventId":"event-one","sourceId":"source-one","projectId":"project-one","triggerId":"trigger-one","revision":1,"occurredAt":now(),"payload":{"test":"private-body-canary"}})
    }
    fn send(receiver: &Receiver, token: &str, body: &Value, extra: &str) -> (u16, Value) {
        let bytes = serde_json::to_vec(body).unwrap();
        request(receiver, format!("POST /events HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer {token}\r\nContent-Length: {}\r\n{extra}\r\n", bytes.len()).as_bytes(), &bytes)
    }
    fn request(receiver: &Receiver, header: &[u8], body: &[u8]) -> (u16, Value) {
        let address = receiver
            .endpoint
            .strip_prefix("http://")
            .unwrap()
            .strip_suffix("/events")
            .unwrap();
        let mut stream = TcpStream::connect(address).unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(2)))
            .unwrap();
        stream.write_all(header).unwrap();
        if !body.is_empty() {
            let _ = stream.write_all(body);
        }
        let mut response = Vec::new();
        match stream.read_to_end(&mut response) {
            Ok(_) => {}
            Err(e) if e.kind() == std::io::ErrorKind::ConnectionReset => {}
            Err(e) => panic!("socket read failed: {e}"),
        }
        let text = String::from_utf8(response).unwrap();
        let (head, body) = text.split_once("\r\n\r\n").unwrap();
        assert!(!head.contains("Access-Control"));
        (
            head.split_whitespace().nth(1).unwrap().parse().unwrap(),
            serde_json::from_str(body).unwrap(),
        )
    }
    fn start(root: &std::path::Path, callback: Consumer, alive: Alive) -> Receiver {
        Receiver::start(
            root.join("secrets"),
            "external-test".into(),
            "project-one".into(),
            "source-one".into(),
            callback,
            alive,
        )
        .unwrap()
    }
    #[test]
    fn authenticated_tcp_rotation_duplicate_and_stop() {
        let tmp = directory();
        credential(tmp.path(), "synthetic-token-one");
        let count = Arc::new(AtomicUsize::new(0));
        let seen = count.clone();
        let mut receiver = start(
            tmp.path(),
            Arc::new(move |e| {
                assert_eq!(e.trigger_id, "trigger-one");
                Ok(
                    json!({"claimed":seen.fetch_add(1, Ordering::SeqCst)==0,"queued":true,"payload":"private-body-canary","secret":"synthetic-token-one"}),
                )
            }),
            Arc::new(|| true),
        );
        assert!(receiver.endpoint.starts_with("http://127.0.0.1:"));
        let (status, result) = send(&receiver, "synthetic-token-one", &body(), "");
        assert_eq!(status, 200);
        assert_eq!(
            result,
            json!({"accepted":true,"duplicate":false,"queued":true})
        );
        assert_eq!(
            send(&receiver, "synthetic-token-one", &body(), "").1["duplicate"],
            true
        );
        assert_eq!(send(&receiver, "wrong-token", &body(), "").0, 401);
        credential(tmp.path(), "synthetic-token-two");
        assert_eq!(send(&receiver, "synthetic-token-one", &body(), "").0, 401);
        assert_eq!(send(&receiver, "synthetic-token-two", &body(), "").0, 200);
        assert_eq!(count.load(Ordering::SeqCst), 3);
        let address = receiver
            .endpoint
            .trim_start_matches("http://")
            .trim_end_matches("/events")
            .to_string();
        receiver.stop();
        receiver.stop();
        assert!(TcpStream::connect(&address).is_err());
        assert!(TcpListener::bind(address).is_ok());
    }
    #[test]
    fn binding_time_size_http_and_rate_fail_closed() {
        let tmp = directory();
        credential(tmp.path(), "synthetic-token");
        let calls = Arc::new(AtomicUsize::new(0));
        let seen = calls.clone();
        let receiver = start(
            tmp.path(),
            Arc::new(move |_| {
                seen.fetch_add(1, Ordering::SeqCst);
                Ok(json!({}))
            }),
            Arc::new(|| true),
        );
        let mut b = body();
        b["projectId"] = json!("project-other");
        assert_eq!(send(&receiver, "synthetic-token", &b, "").0, 400);
        b = body();
        b["sourceId"] = json!("source-other");
        assert_eq!(send(&receiver, "synthetic-token", &b, "").0, 400);
        b = body();
        b["occurredAt"] = json!(now() - 300001);
        assert_eq!(send(&receiver, "synthetic-token", &b, "").0, 400);
        b = body();
        b["occurredAt"] = json!(now() + 31000);
        assert_eq!(send(&receiver, "synthetic-token", &b, "").0, 400);
        b = body();
        b["payload"] = json!("x".repeat(32769));
        assert_eq!(send(&receiver, "synthetic-token", &b, "").0, 413);
        assert_eq!(
            send(
                &receiver,
                "synthetic-token",
                &body(),
                "Authorization: Bearer synthetic-token\r\n"
            )
            .0,
            400
        );
        assert_eq!(
            send(
                &receiver,
                "synthetic-token",
                &body(),
                "Transfer-Encoding: chunked\r\n"
            )
            .0,
            400
        );
        assert_eq!(
            request(
                &receiver,
                b"POST /events HTTP/1.1\r\nContent-Length: 65536\r\n\r\n",
                &[]
            )
            .0,
            413
        );
        assert_eq!(
            request(
                &receiver,
                b"POST /events?x=1 HTTP/1.1\r\nContent-Length: 1\r\n\r\n",
                b"x"
            )
            .0,
            400
        );
        assert_eq!(
            request(&receiver, b"POST /events HTTP/1.1\r\n\r\n", &[]).0,
            400
        );
        assert_eq!(send(&receiver, "synthetic-token", &body(), "").0, 429);
        assert_eq!(calls.load(Ordering::SeqCst), 0);
        thread::sleep(Duration::from_millis(1050));
        assert_eq!(send(&receiver, "synthetic-token", &body(), "").0, 200);
    }
    #[test]
    fn inactive_shutdown_and_slow_client_are_bounded() {
        let tmp = directory();
        credential(tmp.path(), "synthetic-token");
        let active = Arc::new(AtomicBool::new(true));
        let flag = active.clone();
        let mut receiver = start(
            tmp.path(),
            Arc::new(|_| Ok(json!({}))),
            Arc::new(move || flag.load(Ordering::Acquire)),
        );
        let address = receiver
            .endpoint
            .trim_start_matches("http://")
            .trim_end_matches("/events")
            .to_string();
        let mut stream = TcpStream::connect(&address).unwrap();
        stream.write_all(b"POST ").unwrap();
        thread::sleep(Duration::from_millis(50));
        active.store(false, Ordering::Release);
        let before = Instant::now();
        receiver.stop();
        assert!(before.elapsed() < Duration::from_secs(1));
        drop(stream);
        assert!(TcpStream::connect(address).is_err());
    }
    #[test]
    fn strict_event_and_constant_time_comparison() {
        assert!(constant_time(b"a", b"a"));
        assert!(!constant_time(b"a", b"a\0"));
        assert!(!constant_time(b"a", b"b"));
        assert!(!constant_time(b"", b""));
        let mut b = body();
        b["unknown"] = json!(true);
        assert!(serde_json::from_value::<Event>(b).is_err());
        let mut b = body();
        b["revision"] = json!(0);
        assert!(
            serde_json::from_value::<Event>(b)
                .unwrap()
                .validate("project-one", "source-one", now())
                .is_err()
        );
        let mut b = body();
        b["eventId"] = json!("../unsafe");
        assert!(
            serde_json::from_value::<Event>(b)
                .unwrap()
                .validate("project-one", "source-one", now())
                .is_err()
        );
    }
}
