use super::*;
use crate::mcp_client::Transport;
use reqwest::header::HeaderName;
use serde_json::json;
use std::{
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    thread,
    time::{Duration, Instant},
};

fn request(id: u64) -> Value {
    json!({"jsonrpc":"2.0","id":id,"method":"tools/list","params":{}})
}
fn accept(listener: &TcpListener) -> TcpStream {
    let began = Instant::now();
    loop {
        match listener.accept() {
            Ok((stream, _)) => {
                stream.set_nonblocking(false).unwrap();
                stream
                    .set_read_timeout(Some(Duration::from_secs(3)))
                    .unwrap();
                return stream;
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                assert!(began.elapsed() < Duration::from_secs(4));
                thread::sleep(Duration::from_millis(5));
            }
            Err(e) => panic!("{e}"),
        }
    }
}
fn read_request(stream: &mut TcpStream) -> (String, Value) {
    let mut bytes = Vec::new();
    let mut one = [0; 1];
    while !bytes.ends_with(b"\r\n\r\n") {
        stream.read_exact(&mut one).unwrap();
        bytes.push(one[0]);
        assert!(bytes.len() < 16384);
    }
    let headers = String::from_utf8(bytes).unwrap();
    let length = headers
        .lines()
        .find_map(|l| {
            l.to_ascii_lowercase()
                .strip_prefix("content-length:")
                .map(|n| n.trim().parse::<usize>().unwrap())
        })
        .unwrap_or(0);
    let mut body = vec![0; length];
    stream.read_exact(&mut body).unwrap();
    (
        headers.to_ascii_lowercase(),
        if body.is_empty() {
            Value::Null
        } else {
            serde_json::from_slice(&body).unwrap()
        },
    )
}
fn respond(stream: &mut TcpStream, status: u16, kind: &str, extra: &str, body: &str) {
    write!(stream,"HTTP/1.1 {status} Result\r\nContent-Type: {kind}\r\nContent-Length: {}\r\nConnection: close\r\n{extra}\r\n{body}",body.len()).unwrap();
    stream.flush().unwrap();
}
fn fixture(f: impl FnOnce(TcpListener) + Send + 'static) -> (reqwest::Url, thread::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let url =
        reqwest::Url::parse(&format!("http://{}/mcp", listener.local_addr().unwrap())).unwrap();
    (url, thread::spawn(move || f(listener)))
}
fn transport(url: reqwest::Url) -> HttpTransport {
    HttpTransport::new(url, HeaderMap::new(), HttpMode::Loopback, 1000).unwrap()
}

#[test]
fn json_session_headers_notification_and_delete_405() {
    let (url, server) = fixture(|l| {
        for index in 0..4 {
            let mut s = accept(&l);
            let (h, b) = read_request(&mut s);
            assert!(h.contains("authorization: bearer synthetic"));
            if index == 0 {
                assert!(h.contains("accept: application/json, text/event-stream"));
                assert!(!h.contains("mcp-session-id:"));
                respond(
                    &mut s,
                    200,
                    "application/json",
                    "Mcp-Session-Id: private-session\r\n",
                    r#"{"jsonrpc":"2.0","id":1,"result":{}}"#,
                );
            } else {
                assert!(h.contains("mcp-session-id: private-session"));
                assert!(h.contains("mcp-protocol-version: 2025-11-25"));
                match index {
                    1 => {
                        assert_eq!(b["method"], "notifications/initialized");
                        respond(&mut s, 202, "application/json", "", "");
                    }
                    2 => respond(
                        &mut s,
                        200,
                        "application/json",
                        "",
                        r#"{"jsonrpc":"2.0","id":2,"result":{}}"#,
                    ),
                    _ => {
                        assert!(h.starts_with("delete "));
                        respond(&mut s, 405, "application/json", "", "");
                    }
                }
            }
        }
    });
    let mut headers = HeaderMap::new();
    headers.insert(
        "authorization",
        HeaderValue::from_static("Bearer synthetic"),
    );
    let mut t = HttpTransport::new(url, headers, HttpMode::Loopback, 1000).unwrap();
    let mut init = request(1);
    init["method"] = "initialize".into();
    assert!(t.exchange(&init, &|| Ok(())).unwrap().is_some());
    t.negotiated("2025-11-25").unwrap();
    assert!(t
        .exchange(
            &json!({"jsonrpc":"2.0","method":"notifications/initialized"}),
            &|| Ok(())
        )
        .unwrap()
        .is_none());
    assert_eq!(
        t.exchange(&request(2), &|| Ok(())).unwrap().unwrap()["id"],
        2
    );
    t.close().unwrap();
    t.close().unwrap();
    server.join().unwrap();
}
#[test]
fn chunked_sse_multiline_utf8_and_reverse_request_denial() {
    let (url, server) = fixture(|l| {
        let mut s = accept(&l);
        read_request(&mut s);
        write!(s,"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream; charset=utf-8\r\nTransfer-Encoding: chunked\r\n\r\n").unwrap();
        let first = "id: prime\r\ndata:\r\n\r\ndata: {\"jsonrpc\":\"2.0\",\"method\":\"notifications/progress\"}\r\n\r\ndata: {\"jsonrpc\":\"2.0\",\"id\":99,\"method\":\"sampling/createMessage\"}\r\n\r\n";
        write!(s, "{:x}\r\n{first}\r\n", first.len()).unwrap();
        s.flush().unwrap();
        let mut reverse = accept(&l);
        let (_, b) = read_request(&mut reverse);
        assert_eq!(b["id"], 99);
        assert_eq!(b["error"]["code"], -32601);
        respond(&mut reverse, 202, "application/json", "", "");
        let last =
            "data: {\"jsonrpc\":\"2.0\",\r\ndata: \"id\":1,\"result\":{\"text\":\"巴黎\"}}\r\n\r\n";
        for byte in last.as_bytes() {
            write!(s, "1\r\n").unwrap();
            s.write_all(&[*byte]).unwrap();
            s.write_all(b"\r\n").unwrap();
        }
        s.write_all(b"0\r\n\r\n").unwrap();
    });
    let mut t = transport(url);
    assert_eq!(
        t.exchange(&request(1), &|| Ok(())).unwrap().unwrap()["result"]["text"],
        "巴黎"
    );
    server.join().unwrap();
}
#[test]
fn cancellation_drops_hanging_sse_connection() {
    let (url, server) = fixture(|l| {
        let mut s = accept(&l);
        read_request(&mut s);
        write!(s,"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: 1000\r\n\r\ndata:").unwrap();
        s.flush().unwrap();
        let mut b = [0; 1];
        assert_eq!(s.read(&mut b).unwrap(), 0);
    });
    let mut t = transport(url);
    let began = Instant::now();
    let result = t.exchange(&request(1), &|| {
        if began.elapsed() > Duration::from_millis(80) {
            Err("BLK-MCP-CANCELLED".into())
        } else {
            Ok(())
        }
    });
    assert_eq!(result.unwrap_err(), "BLK-MCP-CANCELLED");
    assert!(began.elapsed() < Duration::from_secs(1));
    server.join().unwrap();
}
#[test]
fn expires_without_reinitializing_or_replaying() {
    let (url, server) = fixture(|l| {
        let mut s = accept(&l);
        read_request(&mut s);
        respond(
            &mut s,
            200,
            "application/json",
            "Mcp-Session-Id: s\r\n",
            r#"{"jsonrpc":"2.0","id":1,"result":{}}"#,
        );
        let mut s = accept(&l);
        let (_, b) = read_request(&mut s);
        assert_eq!(b["id"], 2);
        respond(&mut s, 404, "application/json", "", "");
    });
    let mut t = transport(url);
    let mut init = request(1);
    init["method"] = "initialize".into();
    t.exchange(&init, &|| Ok(())).unwrap();
    assert_eq!(
        t.exchange(&request(2), &|| Ok(())).unwrap_err(),
        "BLK-MCP-SESSION-EXPIRED"
    );
    assert_eq!(
        t.exchange(&request(2), &|| Ok(())).unwrap_err(),
        "BLK-MCP-SESSION-EXPIRED"
    );
    server.join().unwrap();
}
#[test]
fn rejects_invalid_response_status_type_and_id() {
    for (status, kind, body, code) in [
        (302, "application/json", "", "BLK-MCP-REDIRECT"),
        (403, "application/json", "", "BLK-MCP-HTTP"),
        (500, "application/json", "", "BLK-MCP-HTTP"),
        (202, "application/json", "", "BLK-MCP-PROTOCOL"),
        (200, "text/plain", "{}", "BLK-MCP-CONTENT-TYPE"),
        (
            200,
            "application/json",
            r#"{"jsonrpc":"2.0","id":2,"result":{}}"#,
            "BLK-MCP-PROTOCOL",
        ),
        (200, "application/json", "[]", "BLK-MCP-PROTOCOL"),
    ] {
        let (url, server) = fixture(move |l| {
            let mut s = accept(&l);
            read_request(&mut s);
            respond(&mut s, status, kind, "", body);
        });
        let mut t = transport(url);
        assert_eq!(t.exchange(&request(1), &|| Ok(())).unwrap_err(), code);
        server.join().unwrap();
    }
}
#[test]
fn validates_endpoint_headers_and_budgets() {
    for url in [
        "http://localhost:4321/mcp",
        "http://192.168.1.1:4321/mcp",
        "http://127.0.0.1/mcp",
        "http://user@127.0.0.1:4321/mcp",
        "http://127.0.0.1:4321/mcp#frag",
    ] {
        assert!(HttpTransport::new(
            reqwest::Url::parse(url).unwrap(),
            HeaderMap::new(),
            HttpMode::Loopback,
            1000
        )
        .is_err());
    }
    assert!(HttpTransport::new(
        reqwest::Url::parse("https://127.0.0.1:4321/mcp").unwrap(),
        HeaderMap::new(),
        HttpMode::Remote,
        1000
    )
    .is_err());
    for name in [
        "host",
        "connection",
        "content-length",
        "mcp-session-id",
        "mcp-protocol-version",
    ] {
        let mut h = HeaderMap::new();
        h.insert(
            HeaderName::from_bytes(name.as_bytes()).unwrap(),
            HeaderValue::from_static("synthetic"),
        );
        assert!(HttpTransport::new(
            reqwest::Url::parse("http://127.0.0.1:4321/mcp").unwrap(),
            h,
            HttpMode::Loopback,
            1000
        )
        .is_err());
    }
    for timeout in [0, 120001] {
        assert!(HttpTransport::new(
            reqwest::Url::parse("http://127.0.0.1:4321/mcp").unwrap(),
            HeaderMap::new(),
            HttpMode::Loopback,
            timeout
        )
        .is_err());
    }
}

#[test]
fn timeout_drops_pending_http_headers() {
    let (url, server) = fixture(|l| {
        let mut s = accept(&l);
        read_request(&mut s);
        let mut b = [0; 1];
        assert_eq!(s.read(&mut b).unwrap(), 0);
    });
    let mut t = HttpTransport::new(url, HeaderMap::new(), HttpMode::Loopback, 80).unwrap();
    let began = Instant::now();
    assert_eq!(
        t.exchange(&request(1), &|| Ok(())).unwrap_err(),
        "BLK-MCP-TIMEOUT"
    );
    assert!(began.elapsed() < Duration::from_secs(1));
    server.join().unwrap();
}
#[test]
fn delete_settlement_deadline_and_failure_are_explicit() {
    for hang in [false, true] {
        let (url, server) = fixture(move |l| {
            let mut s = accept(&l);
            read_request(&mut s);
            respond(
                &mut s,
                200,
                "application/json",
                "Mcp-Session-Id: s\r\n",
                r#"{"jsonrpc":"2.0","id":1,"result":{}}"#,
            );
            let mut s = accept(&l);
            let (h, _) = read_request(&mut s);
            assert!(h.starts_with("delete "));
            if hang {
                let mut b = [0; 1];
                assert_eq!(s.read(&mut b).unwrap(), 0);
            } else {
                respond(&mut s, 503, "application/json", "", "");
            }
        });
        let mut t = transport(url);
        let mut init = request(1);
        init["method"] = "initialize".into();
        t.exchange(&init, &|| Ok(())).unwrap();
        let began = Instant::now();
        assert_eq!(
            t.close().unwrap_err(),
            if hang {
                "BLK-MCP-TIMEOUT"
            } else {
                "BLK-MCP-HTTP"
            }
        );
        assert!(began.elapsed() < Duration::from_millis(2400));
        assert_eq!(
            t.exchange(&request(2), &|| Ok(())).unwrap_err(),
            "BLK-MCP-CLOSED"
        );
        server.join().unwrap();
    }
}
#[test]
fn frame_total_and_notification_bounds_are_enforced_over_tcp() {
    let bodies = [
        (
            "application/json",
            format!(
                "{{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{{\"text\":\"{}\"}}}}",
                "x".repeat(FRAME)
            ),
            "BLK-MCP-LIMIT",
        ),
        (
            "text/event-stream",
            format!("data: {}\n\n", "x".repeat(FRAME)),
            "BLK-MCP-LIMIT",
        ),
        (
            "text/event-stream",
            "data: {\"jsonrpc\":\"2.0\",\"method\":\"notifications/progress\"}\n\n".repeat(65),
            "BLK-MCP-LIMIT",
        ),
        (
            "text/event-stream",
            format!(":{}\n\n", "x".repeat(199990)).repeat(6),
            "BLK-MCP-LIMIT",
        ),
    ];
    for (kind, body, code) in bodies {
        let (url, server) = fixture(move |l| {
            let mut s = accept(&l);
            read_request(&mut s);
            let _ = write!(
                s,
                "HTTP/1.1 200 OK\r\nContent-Type: {kind}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
        });
        let mut t = transport(url);
        assert_eq!(t.exchange(&request(1), &|| Ok(())).unwrap_err(), code);
        server.join().unwrap();
    }
}
#[test]
fn rejects_invalid_utf8_and_nonempty_202() {
    for notification in [false, true] {
        let (url, server) = fixture(move |l| {
            let mut s = accept(&l);
            read_request(&mut s);
            if notification {
                respond(&mut s, 202, "application/json", "", "x");
            } else {
                s.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: 10\r\n\r\ndata: \xff\n\n ").unwrap();
            }
        });
        let mut t = transport(url);
        let message = if notification {
            json!({"jsonrpc":"2.0","method":"notifications/initialized"})
        } else {
            request(1)
        };
        assert_eq!(t.exchange(&message, &|| Ok(())).unwrap_err(), PROTOCOL);
        server.join().unwrap();
    }
}
#[test]
fn rejects_unsafe_session_and_secret_header_values() {
    for sid in ["space invalid", "s\r\nMcp-Session-Id: second"] {
        let (url, server) = fixture(move |l| {
            let mut s = accept(&l);
            read_request(&mut s);
            respond(
                &mut s,
                200,
                "application/json",
                &format!("Mcp-Session-Id: {sid}\r\n"),
                r#"{"jsonrpc":"2.0","id":1,"result":{}}"#,
            );
        });
        let mut t = transport(url);
        let mut init = request(1);
        init["method"] = "initialize".into();
        assert_eq!(
            t.exchange(&init, &|| Ok(())).unwrap_err(),
            "BLK-MCP-SESSION"
        );
        server.join().unwrap();
    }
    for value in [
        HeaderValue::from_bytes(b"a\tb").unwrap(),
        HeaderValue::from_bytes(&[0x80]).unwrap(),
        HeaderValue::from_str(&"x".repeat(4097)).unwrap(),
    ] {
        let mut h = HeaderMap::new();
        h.insert("authorization", value);
        assert!(HttpTransport::new(
            Url::parse("http://127.0.0.1:4321/mcp").unwrap(),
            h,
            HttpMode::Loopback,
            1000
        )
        .is_err());
    }
    let mut h = HeaderMap::new();
    h.append("authorization", HeaderValue::from_static("one"));
    h.append("authorization", HeaderValue::from_static("two"));
    assert!(HttpTransport::new(
        Url::parse("http://127.0.0.1:4321/mcp").unwrap(),
        h,
        HttpMode::Loopback,
        1000
    )
    .is_err());
}

#[test]
fn real_tcp_client_initialization_discovery_call_and_close() {
    let (url, server) = fixture(|l| {
        for step in 0..5 {
            let mut s = accept(&l);
            let (h, b) = read_request(&mut s);
            if step > 0 {
                assert!(h.contains("mcp-session-id: session"));
                assert!(h.contains("mcp-protocol-version: 2025-11-25"));
            }
            match step {
                0 => respond(
                    &mut s,
                    200,
                    "application/json",
                    "Mcp-Session-Id: session\r\n",
                    r#"{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-11-25","capabilities":{"tools":{}},"serverInfo":{"name":"Synthetic","version":"1"}}}"#,
                ),
                1 => {
                    assert_eq!(b["method"], "notifications/initialized");
                    respond(&mut s, 202, "application/json", "", "");
                }
                2 => {
                    assert_eq!(b["method"], "tools/list");
                    respond(
                        &mut s,
                        200,
                        "application/json",
                        "",
                        r#"{"jsonrpc":"2.0","id":2,"result":{"tools":[{"name":"echo","inputSchema":{"type":"object","properties":{}}}]}}"#,
                    )
                }
                3 => {
                    assert_eq!(b["method"], "tools/call");
                    respond(
                        &mut s,
                        200,
                        "application/json",
                        "",
                        r#"{"jsonrpc":"2.0","id":3,"result":{"content":[{"type":"text","text":"synthetic"}]}}"#,
                    )
                }
                _ => {
                    assert!(h.starts_with("delete "));
                    respond(&mut s, 204, "application/json", "", "");
                }
            }
        }
    });
    let mut client = crate::mcp_client::Client::connect(transport(url), &|| Ok(())).unwrap();
    assert_eq!(client.tools(&|| Ok(())).unwrap()[0]["name"], "echo");
    assert_eq!(
        client.call_tool("echo", json!({}), &|| Ok(())).unwrap()["content"][0]["text"],
        "synthetic"
    );
    client.close().unwrap();
    server.join().unwrap();
}
#[test]
fn disconnect_does_not_retry_post() {
    let (url, server) = fixture(|l| {
        let mut s = accept(&l);
        read_request(&mut s);
        drop(s);
        thread::sleep(Duration::from_millis(150));
        assert!(matches!(l.accept(),Err(e)if e.kind()==std::io::ErrorKind::WouldBlock));
    });
    let mut t = transport(url);
    assert_eq!(
        t.exchange(&request(1), &|| Ok(())).unwrap_err(),
        "BLK-MCP-TRANSPORT"
    );
    server.join().unwrap();
}
#[test]
fn changed_session_is_rejected_and_old_session_settled() {
    let (url, server) = fixture(|l| {
        let mut s = accept(&l);
        read_request(&mut s);
        respond(
            &mut s,
            200,
            "application/json",
            "Mcp-Session-Id: first\r\n",
            r#"{"jsonrpc":"2.0","id":1,"result":{}}"#,
        );
        let mut s = accept(&l);
        read_request(&mut s);
        respond(
            &mut s,
            200,
            "application/json",
            "Mcp-Session-Id: second\r\n",
            r#"{"jsonrpc":"2.0","id":2,"result":{}}"#,
        );
        let mut s = accept(&l);
        let (h, _) = read_request(&mut s);
        assert!(h.starts_with("delete "));
        assert!(h.contains("mcp-session-id: first"));
        respond(&mut s, 204, "application/json", "", "");
    });
    let mut t = transport(url);
    let mut init = request(1);
    init["method"] = "initialize".into();
    t.exchange(&init, &|| Ok(())).unwrap();
    assert_eq!(
        t.exchange(&request(2), &|| Ok(())).unwrap_err(),
        "BLK-MCP-SESSION"
    );
    t.close().unwrap();
    server.join().unwrap();
}
