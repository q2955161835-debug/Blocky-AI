use super::*;
use serde_json::json;
use std::io::{Read, Write};
fn request() -> ProviderRequest {
    serde_json::from_value(json!({"schemaVersion":"blocky.provider-request/v1","requestId":"r1","projectId":"p1","resourceId":"m1","secretRef":"s1","modelId":"deepseek-chat","messages":[{"role":"user","content":"public fixture"}],"maxOutputTokens":1024,"timeoutMs":500})).unwrap()
}
fn response() -> Value {
    json!({"id":"response-1","model":"returned-model","choices":[{"message":{"role":"assistant","content":"public response"},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":2,"total_tokens":5}})
}
fn registry() -> Value {
    json!({"resources":[{"resourceId":"m1","scope":"user","kind":"model","definition":{"provider":"deepseek","protocol":"openai-chat","modelId":"deepseek-chat"},"secretBindings":[{"fieldId":"apiKey","secretRef":"s1"}]}]})
}
#[test]
fn request_limits_and_exact_digest() {
    let mut r = request();
    assert_eq!(r.body()["thinking"]["type"], "disabled");
    let digest = r.digest().unwrap();
    r.messages[0].content.push('x');
    assert_ne!(digest, r.digest().unwrap());
    r.max_output_tokens = 1025;
    assert!(r.validate().is_err());
    r = request();
    r.timeout_ms = 120001;
    assert!(r.validate().is_err());
    r = request();
    r.messages[0].role = "tool".into();
    assert!(r.validate().is_err());
    r = request();
    r.messages[0].content = "x".repeat(32769);
    assert!(r.validate().is_err());
    r = request();
    r.model_id = "https://evil.example".into();
    assert!(r.validate().is_err());
    let mut v = serde_json::to_value(request()).unwrap();
    v["endpoint"] = json!("https://evil.example");
    assert!(serde_json::from_value::<ProviderRequest>(v).is_err());
}
#[test]
fn binding_is_host_owned_and_cannot_override_endpoint_or_secret() {
    let r = request();
    let v = registry();
    assert!(types::check_binding(&v, &r).is_ok());
    for (field, value) in [
        ("provider", "other"),
        ("protocol", "openai-responses"),
        ("modelId", "another"),
        ("baseUrl", "https://localhost/"),
    ] {
        let mut v = registry();
        v["resources"][0]["definition"][field] = json!(value);
        assert!(types::check_binding(&v, &r).is_err());
    }
    let mut v = registry();
    v["resources"][0]["secretBindings"][0]["secretRef"] = json!("other");
    assert!(types::check_binding(&v, &r).is_err());
}
#[test]
fn responses_require_actual_usage_finished_text_and_identity() {
    assert_eq!(
        transport::parse(response().to_string().as_bytes(), 1024).unwrap()["usage"]["totalTokens"],
        5
    );
    for v in [
        json!({}),
        json!({"error":"synthetic-private-error-body"}),
        {
            let mut v = response();
            v["usage"] = Value::Null;
            v
        },
        {
            let mut v = response();
            v["usage"]["total_tokens"] = json!(99);
            v
        },
        {
            let mut v = response();
            v["choices"][0]["finish_reason"] = json!("length");
            v
        },
        {
            let mut v = response();
            v["choices"][0]["message"]["content"] = json!("");
            v
        },
    ] {
        assert_eq!(
            transport::parse(v.to_string().as_bytes(), 1024).unwrap_err(),
            "BLK-PROVIDER-RESPONSE"
        );
    }
    assert_eq!(
        transport::parse(b"invalid json", 1024).unwrap_err(),
        "BLK-PROVIDER-RESPONSE"
    );
    assert!(transport::parse(response().to_string().as_bytes(), 1).is_err());
}
#[test]
fn cancellation_size_and_failure_body_are_bounded() {
    let cancel = AtomicBool::new(true);
    assert_eq!(
        transport::consume(&b"a"[..], &cancel).unwrap_err(),
        "BLK-PROVIDER-CANCELLED"
    );
    assert_eq!(
        transport::consume(&vec![b'x'; 262145][..], &AtomicBool::new(false)).unwrap_err(),
        "BLK-PROVIDER-LIMIT"
    );
    for (status, code) in [
        (401, "BLK-PROVIDER-AUTH"),
        (403, "BLK-PROVIDER-AUTH"),
        (429, "BLK-PROVIDER-RATE"),
        (500, "BLK-PROVIDER-SERVICE"),
        (503, "BLK-PROVIDER-SERVICE"),
        (302, "BLK-PROVIDER-HTTP"),
    ] {
        assert_eq!(transport::status(status).unwrap_err(), code);
    }
    let h = ProviderHost::default();
    h.cancel("r1").unwrap();
    assert!(h.state.lock().unwrap().used.contains("r1"));
    h.shutdown().unwrap();
    assert!(h.state.lock().unwrap().closing);
}
fn mock_server(
    status: u16,
    body: String,
    delay_ms: u64,
) -> (String, std::thread::JoinHandle<String>) {
    let (endpoint, join, _) = mock_server_ready(status, body, delay_ms);
    (endpoint, join)
}
fn mock_server_ready(
    status: u16,
    body: String,
    delay_ms: u64,
) -> (
    String,
    std::thread::JoinHandle<String>,
    std::sync::mpsc::Receiver<()>,
) {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let (ready_tx, ready_rx) = std::sync::mpsc::channel();
    let endpoint = format!("http://{}/chat/completions", listener.local_addr().unwrap());
    let join = std::thread::spawn(move || {
        let started = std::time::Instant::now();
        let mut socket = loop {
            match listener.accept() {
                Ok((socket, _)) => break socket,
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    if started.elapsed() > Duration::from_secs(3) {
                        return String::new();
                    }
                    std::thread::sleep(Duration::from_millis(5));
                }
                Err(e) => panic!("mock accept: {e}"),
            }
        };
        socket.set_nonblocking(false).unwrap();
        socket
            .set_read_timeout(Some(Duration::from_secs(2)))
            .unwrap();
        let mut bytes = Vec::new();
        let mut chunk = [0; 8192];
        loop {
            let n = socket.read(&mut chunk).unwrap();
            bytes.extend_from_slice(&chunk[..n]);
            if n == 0 {
                break;
            }
            if let Some(index) = bytes.windows(4).position(|w| w == b"\r\n\r\n") {
                let headers = String::from_utf8_lossy(&bytes[..index]);
                let length = headers
                    .lines()
                    .find_map(|l| {
                        l.to_lowercase()
                            .strip_prefix("content-length:")
                            .and_then(|v| v.trim().parse::<usize>().ok())
                    })
                    .unwrap_or(0);
                if bytes.len() >= index + 4 + length {
                    break;
                }
            }
        }
        let _ = ready_tx.send(());
        std::thread::sleep(Duration::from_millis(delay_ms));
        let _ = write!(
            socket,
            "HTTP/1.1 {status} Test\r\nContent-Length: {}\r\nConnection: close\r\nLocation: http://127.0.0.1:1/never\r\n\r\n{body}",
            body.len()
        );
        String::from_utf8(bytes).unwrap()
    });
    (endpoint, join, ready_rx)
}
#[test]
fn real_http_transport_with_local_only_mock_checks_auth_and_errors() {
    for (status, body, expected) in [
        (200, response().to_string(), None),
        (
            401,
            "synthetic-private-error".into(),
            Some("BLK-PROVIDER-AUTH"),
        ),
        (
            429,
            "synthetic-private-error".into(),
            Some("BLK-PROVIDER-RATE"),
        ),
        (
            503,
            "synthetic-private-error".into(),
            Some("BLK-PROVIDER-SERVICE"),
        ),
        (200, "broken json".into(), Some("BLK-PROVIDER-RESPONSE")),
        (302, "".into(), Some("BLK-PROVIDER-HTTP")),
    ] {
        let (endpoint, join) = mock_server(status, body, 0);
        let result = transport::mock_send(&endpoint, &request(), &AtomicBool::new(false));
        if let Some(code) = expected {
            assert_eq!(result.unwrap_err(), code);
        } else {
            assert_eq!(result.unwrap()["transport"], "remote");
        }
        let received = join.join().unwrap();
        assert!(received
            .to_lowercase()
            .contains("authorization: bearer synthetic-test-key"));
        assert!(received.contains("\"max_tokens\":1024"));
        assert!(received.contains("\"stream\":false"));
    }
}
#[test]
fn transport_timeout_and_late_cancel_settle_without_orphans() {
    let (endpoint, join) = mock_server(200, response().to_string(), 150);
    let mut r = request();
    r.timeout_ms = 30;
    assert_eq!(
        transport::mock_send(&endpoint, &r, &AtomicBool::new(false)).unwrap_err(),
        "BLK-PROVIDER-TIMEOUT"
    );
    join.join().unwrap();
    let (endpoint, join, ready) = mock_server_ready(200, response().to_string(), 250);
    let cancel = Arc::new(AtomicBool::new(false));
    let c = cancel.clone();
    let worker = std::thread::spawn(move || transport::mock_send(&endpoint, &request(), &c));
    ready.recv_timeout(Duration::from_secs(3)).unwrap();
    cancel.store(true, Ordering::SeqCst);
    assert_eq!(
        worker.join().unwrap().unwrap_err(),
        "BLK-PROVIDER-CANCELLED"
    );
    join.join().unwrap();
}
#[test]
fn helper_rejects_unapproved_or_unknown_fields_without_network() {
    let mut envelope = json!({"schemaVersion":"blocky.project-io/v1alpha1","operation":"provider-call","request":request()});
    assert_eq!(
        dispatch(PathBuf::new(), &envelope).unwrap_err(),
        "BLK-PERM-001"
    );
    envelope["approval"] = json!({"approved":true,"requestDigest":"wrong"});
    assert_eq!(
        dispatch(PathBuf::new(), &envelope).unwrap_err(),
        "BLK-PERM-001"
    );
    envelope["arbitraryEndpoint"] = json!("bad");
    assert_eq!(
        dispatch(PathBuf::new(), &envelope).unwrap_err(),
        types::INVALID
    );
}
#[test]
fn cancelling_headers_and_body_drops_connection_within_two_seconds() {
    for send_headers in [false, true] {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let endpoint = format!("http://{}/chat/completions", listener.local_addr().unwrap());
        let (ready_tx, ready_rx) = std::sync::mpsc::channel();
        let server = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            socket
                .set_read_timeout(Some(Duration::from_secs(3)))
                .unwrap();
            let mut bytes = Vec::new();
            let mut chunk = [0; 8192];
            loop {
                let n = socket.read(&mut chunk).unwrap();
                bytes.extend_from_slice(&chunk[..n]);
                if let Some(index) = bytes.windows(4).position(|w| w == b"\r\n\r\n") {
                    let headers = String::from_utf8_lossy(&bytes[..index]);
                    let length = headers
                        .lines()
                        .find_map(|l| {
                            l.to_lowercase()
                                .strip_prefix("content-length:")
                                .and_then(|v| v.trim().parse::<usize>().ok())
                        })
                        .unwrap_or(0);
                    if bytes.len() >= index + 4 + length {
                        break;
                    }
                }
            }
            if send_headers {
                socket
                    .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 1024\r\n\r\n{")
                    .unwrap();
                socket.flush().unwrap();
            }
            ready_tx.send(()).unwrap();
            // No response completion: only closing the cancelled connection releases this read.
            match socket.read(&mut chunk) {
                Ok(0) => (),
                Err(e) if e.kind() == std::io::ErrorKind::ConnectionReset => (),
                other => panic!("cancel did not close socket: {other:?}"),
            }
        });
        let cancel = Arc::new(AtomicBool::new(false));
        let flag = cancel.clone();
        let mut r = request();
        r.timeout_ms = 5000;
        let worker = std::thread::spawn(move || transport::mock_send(&endpoint, &r, &flag));
        ready_rx.recv_timeout(Duration::from_secs(2)).unwrap();
        let started = Instant::now();
        cancel.store(true, Ordering::SeqCst);
        assert_eq!(
            worker.join().unwrap().unwrap_err(),
            "BLK-PROVIDER-CANCELLED"
        );
        assert!(started.elapsed() < Duration::from_secs(2));
        server.join().unwrap();
    }
}
#[test]
fn provider_cli_consumes_ticket_before_transport_and_rejects_reopen() {
    let directory =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../try/stage4/provider-approval-tests");
    std::fs::create_dir_all(&directory).unwrap();
    let root = tempfile::tempdir_in(directory).unwrap();
    let r = request();
    let d = r.digest().unwrap();
    let call = json!({"schemaVersion":"blocky.project-io/v1alpha1","operation":"provider-call","request":r,"approval":{"approved":true,"requestDigest":d}});
    assert_eq!(
        dispatch(root.path().into(), &call).unwrap_err(),
        "BLK-PERM-001"
    );
    crate::approval_ledger::issue(&root.path().join("approvals"), "provider/p1/r1", &d).unwrap();
    // No credentials: first approved attempt reaches config validation, never a network call.
    assert_eq!(
        dispatch(root.path().into(), &call).unwrap_err(),
        "BLK-PROVIDER-CONFIG"
    );
    assert_eq!(
        dispatch(root.path().into(), &call).unwrap_err(),
        "BLK-PERM-001"
    );
}
