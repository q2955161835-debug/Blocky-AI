use super::*;
use std::io::{Read, Write};

fn read_request(stream: &mut std::net::TcpStream) -> Value {
    stream
        .set_read_timeout(Some(Duration::from_secs(15)))
        .unwrap();
    let mut bytes = Vec::new();
    let mut buffer = [0; 4096];
    loop {
        let n = stream.read(&mut buffer).unwrap();
        assert!(n > 0);
        bytes.extend_from_slice(&buffer[..n]);
        if let Some(end) = bytes.windows(4).position(|part| part == b"\r\n\r\n") {
            let header = String::from_utf8_lossy(&bytes[..end]);
            let length = header
                .lines()
                .find_map(|line| {
                    line.to_lowercase()
                        .strip_prefix("content-length:")
                        .map(|s| s.trim().parse::<usize>().unwrap())
                })
                .unwrap();
            if bytes.len() >= end + 4 + length {
                return crate::strict_json::parse(&bytes[end + 4..end + 4 + length]).unwrap();
            }
        }
        assert!(bytes.len() < 4 * 1024 * 1024);
    }
}
fn chunk(stream: &mut std::net::TcpStream, data: &str) {
    write!(stream, "{:x}\r\n{}\r\n", data.len(), data).unwrap();
    stream.flush().unwrap();
}
fn event(id: &str, delta: Value, finish: Value) -> String {
    format!(
        "data: {}\n\n",
        json!({"id":id,"model":"fixture-model","choices":[{"index":0,"delta":delta,"finish_reason":finish}]})
    )
}
#[test]
fn native_coding_streams_before_provider_finishes_and_preserves_tool_followup() {
    streaming_scenario(false);
}
#[test]
fn native_coding_cancel_settles_provider_and_keeps_public_prefix() {
    streaming_scenario(true);
}
fn streaming_scenario(stop: bool) {
    let base = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../try/builder-repair-2026-10-08/native-stream");
    std::fs::create_dir_all(&base).unwrap();
    let root = tempfile::tempdir_in(base).unwrap();
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let endpoint = format!(
        "http://127.0.0.1:{}/v1",
        listener.local_addr().unwrap().port()
    );
    let file = root.path().join("fixture.env");
    std::fs::write(&file, format!("ENDPOINT={endpoint}\n")).unwrap();
    crate::secret_store::SecretStore::new(root.path().join("secrets"))
        .import_env("endpoint", &file, "ENDPOINT")
        .unwrap();
    let registry = json!({"schemaVersion":"blocky.user-resources/v1","resources":[{"schemaVersion":"blocky.resource/v1alpha1","resourceId":"stream-model","kind":"model","scope":"user","displayName":"Streaming fixture","capabilityRequirements":[],"definition":{"provider":"ollama","modelId":"fixture-model","protocol":"openai-chat","timeoutMs":30000,"capabilities":["text","tools"],"implementationRef":{"kind":"adapter","id":"ollama-v1"}},"secretBindings":[{"fieldId":"baseUrl","secretRef":"endpoint"}]}]});
    crate::user_store::UserStore::new(root.path().join("user"))
        .write("resources", "app", registry)
        .unwrap();
    let (release, wait) = std::sync::mpsc::channel();
    let server = std::thread::spawn(move || {
        let (mut socket, _) = listener.accept().unwrap();
        let first = read_request(&mut socket);
        assert_eq!(first["stream"], true);
        write!(socket,"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n").unwrap();
        chunk(
            &mut socket,
            &event(
                "s1",
                json!({"reasoning_content":"核对画布。","content":"准备核对。"}),
                Value::Null,
            ),
        );
        // The provider cannot finish until the Native GUI callback sees the prefix.
        wait.recv_timeout(Duration::from_secs(10))
            .expect("Real delta must arrive before completion");
        if stop {
            let mut byte = [0];
            match socket.read(&mut byte) {
                Ok(0) => {}
                Err(error)
                    if matches!(
                        error.kind(),
                        std::io::ErrorKind::ConnectionReset | std::io::ErrorKind::ConnectionAborted
                    ) => {}
                other => panic!("Cancelled provider must close before timeout: {other:?}"),
            }
            return;
        }
        chunk(
            &mut socket,
            &event(
                "s1",
                json!({"tool_calls":[{"index":0,"id":"context1","type":"function","function":{"name":"project_context","arguments":"{}"}}]}),
                Value::Null,
            ),
        );
        chunk(&mut socket, &event("s1", json!({}), json!("tool_calls")));
        chunk(&mut socket, "data: [DONE]\n\n");
        write!(socket, "0\r\n\r\n").unwrap();
        drop(socket);
        let (mut socket, _) = listener.accept().unwrap();
        let second = read_request(&mut socket);
        let messages = second["messages"].as_array().unwrap();
        assert!(
            messages
                .iter()
                .any(|m| m["role"] == "assistant" && m["reasoning_content"] == "核对画布。")
        );
        assert!(messages.iter().any(|m| m["role"] == "tool"
            && m["tool_call_id"] == "context1"
            && m["content"].as_str().unwrap().contains("main")));
        write!(socket,"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n").unwrap();
        chunk(
            &mut socket,
            &event("s2", json!({"content":"画布已核对。"}), Value::Null),
        );
        chunk(&mut socket, &event("s2", json!({}), json!("stop")));
        chunk(&mut socket, "data: [DONE]\n\n");
        write!(socket, "0\r\n\r\n").unwrap();
    });
    let project = json!({"manifest":{"schemaVersion":"blocky.project/v1","projectId":"stream-project","displayName":"Stream test","modules":[{"moduleId":"main","displayName":"Main","purpose":"general","workspaceRef":"workspaces/main.workspace.json","exports":[]}],"resources":[],"appSurfaces":[],"format":{"createdWith":"blocky-desktop/0.8.0","minimumReaderVersion":"0.2.0"}},"workspaces":{"main":{"blocks":{"languageVersion":0,"blocks":[]}}},"resources":{},"schemas":{},"surfaces":{}});
    let start:CodingStart=serde_json::from_value(json!({"schemaVersion":"blocky.coding-start/v1","requestId":"stream-run","projectId":"stream-project","moduleId":"main","prompt":"核对","originalJson":project.to_string(),"resourceId":"stream-model","selection":[],"conversation":[]})).unwrap();
    let host = CodingHost::default();
    let approval = host.preflight(root.path(), &start).unwrap();
    let mut actual = Vec::new();
    let mut released = false;
    let result = host.run(
        root.path().to_path_buf(),
        start,
        approval["requestDigest"].as_str().unwrap(),
        &mut |e| {
            if e["kind"] == "text.delta" && !released {
                release.send(()).unwrap();
                released = true;
                if stop {
                    host.cancel("stream-run").unwrap();
                }
            }
            actual.push(e);
            Ok(())
        },
    );
    server.join().unwrap();
    if stop {
        assert_eq!(result.unwrap_err(), "BLK-CODING-CANCELLED");
        assert_eq!(actual[0]["text"], "准备核对。");
        assert!(
            actual
                .iter()
                .all(|e| !e["kind"].as_str().unwrap().starts_with("tool."))
        );
        return;
    }
    let result = result.unwrap();
    assert_eq!(result["text"], "准备核对。画布已核对。");
    assert_eq!(result["events"], json!(actual));
    let kinds = actual
        .iter()
        .map(|e| e["kind"].as_str().unwrap())
        .collect::<Vec<_>>();
    assert_eq!(
        kinds,
        vec![
            "text.delta",
            "thinking.delta",
            "tool.started",
            "tool.completed",
            "text.delta"
        ]
    );
    assert_eq!(
        actual
            .iter()
            .map(|e| e["sequence"].as_u64().unwrap())
            .collect::<Vec<_>>(),
        vec![1, 2, 3, 4, 5]
    );
}
