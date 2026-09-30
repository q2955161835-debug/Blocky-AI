use super::*;
use serde_json::json;
use std::{
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    thread,
    time::{Duration, Instant},
};

fn accept(l: &TcpListener) -> TcpStream {
    let started = Instant::now();
    loop {
        match l.accept() {
            Ok((s, _)) => {
                s.set_nonblocking(false).unwrap();
                s.set_read_timeout(Some(Duration::from_secs(3))).unwrap();
                return s;
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                assert!(started.elapsed() < Duration::from_secs(4));
                thread::sleep(Duration::from_millis(5));
            }
            Err(e) => panic!("{e}"),
        }
    }
}
fn read(s: &mut TcpStream) -> (String, Value) {
    let mut b = Vec::new();
    let mut one = [0];
    while !b.ends_with(b"\r\n\r\n") {
        s.read_exact(&mut one).unwrap();
        b.push(one[0]);
        assert!(b.len() < 65536);
    }
    let h = String::from_utf8(b).unwrap();
    let n = h
        .lines()
        .find_map(|x| {
            x.to_ascii_lowercase()
                .strip_prefix("content-length:")
                .map(|x| x.trim().parse::<usize>().unwrap())
        })
        .unwrap_or(0);
    let mut b = vec![0; n];
    s.read_exact(&mut b).unwrap();
    (
        h,
        if b.is_empty() {
            Value::Null
        } else {
            serde_json::from_slice(&b).unwrap()
        },
    )
}
fn response(s: &mut TcpStream, status: u16, kind: &str, extra: &str, b: &str) {
    write!(s,"HTTP/1.1 {status} Result\r\nContent-Type: {kind}\r\nContent-Length: {}\r\nConnection: close\r\n{extra}\r\n{b}",b.len()).unwrap();
    s.flush().unwrap();
}
fn fixture(f: impl FnOnce(TcpListener) + Send + 'static) -> (Url, thread::JoinHandle<()>) {
    let l = TcpListener::bind("127.0.0.1:0").unwrap();
    l.set_nonblocking(true).unwrap();
    let u = Url::parse(&format!(
        "http://{}/fixed?fixed=yes",
        l.local_addr().unwrap()
    ))
    .unwrap();
    (u, thread::spawn(move || f(l)))
}
fn call(u: Url, m: &str, v: Value) -> Result<Value, String> {
    execute(
        u,
        HeaderMap::new(),
        HttpMode::Loopback,
        m,
        &v,
        1000,
        &|| Ok(()),
    )
}

#[test]
fn get_encodes_scalars_and_retains_fixed_destination() {
    let (u, t) = fixture(|l| {
        let mut s = accept(&l);
        let (h, b) = read(&mut s);
        assert_eq!(b, Value::Null);
        let target = h.lines().next().unwrap().split_whitespace().nth(1).unwrap();
        let u = Url::parse(&format!("http://example.test{target}")).unwrap();
        assert_eq!(u.path(), "/fixed");
        let q = u.query_pairs().collect::<std::collections::HashMap<_, _>>();
        assert_eq!(q["fixed"], "yes");
        assert_eq!(q["q"], "城市 &a=?");
        assert_eq!(q["n"], "12");
        assert_eq!(q["ok"], "true");
        assert_eq!(q["url"], "https://invalid.test/other");
        response(&mut s, 200, "application/json", "", r#"{"ok":true}"#);
    });
    assert_eq!(
        call(
            u,
            "GET",
            json!({"q":"城市 &a=?","n":12,"ok":true,"url":"https://invalid.test/other"})
        )
        .unwrap(),
        json!({"ok":true})
    );
    t.join().unwrap();
}
#[test]
fn post_preserves_input_and_fixed_auth_without_mcp() {
    let (u, t) = fixture(|l| {
        let mut s = accept(&l);
        let (h, b) = read(&mut s);
        assert!(h.starts_with("POST /fixed?fixed=yes "));
        assert!(h.to_lowercase().contains("authorization: bearer synthetic"));
        assert!(!h.to_lowercase().contains("mcp-"));
        assert_eq!(b["host"], "evil.test");
        assert_eq!(b["headers"]["host"], "evil.test");
        response(
            &mut s,
            200,
            "application/problem+json; charset=utf-8",
            "",
            &json!({"answer":b["n"].as_i64().unwrap()+1}).to_string(),
        );
    });
    let mut h = HeaderMap::new();
    h.insert("authorization", "Bearer synthetic".parse().unwrap());
    assert_eq!(
        execute(
            u,
            h,
            HttpMode::Loopback,
            "POST",
            &json!({"n":4,"host":"evil.test","headers":{"host":"evil.test"}}),
            1000,
            &|| Ok(())
        )
        .unwrap(),
        json!({"answer":5})
    );
    t.join().unwrap();
}
#[test]
fn invalid_inputs_and_headers_are_rejected_before_connect() {
    let u = Url::parse("http://127.0.0.1:19999/fixed?%71=x").unwrap();
    for v in [
        json!({"q":"collision"}),
        json!({"a":null}),
        json!({"a":[]}),
        json!({"a":{}}),
        json!([]),
    ] {
        assert!(call(u.clone(), "GET", v)
            .unwrap_err()
            .starts_with("BLK-TOOL-HTTP-INPUT"));
    }
    assert!(call(u.clone(), "DELETE", json!({}))
        .unwrap_err()
        .contains("METHOD"));
    let mut h = HeaderMap::new();
    h.insert("host", "evil.test".parse().unwrap());
    assert_eq!(
        execute(
            u,
            h,
            HttpMode::Loopback,
            "GET",
            &json!({}),
            1000,
            &|| Ok(())
        )
        .unwrap_err(),
        "BLK-TOOL-HTTP-CONFIG"
    );
}
#[test]
fn responses_have_safe_errors_and_strict_json_bounds() {
    let deep = format!("{}0{}", "[".repeat(34), "]".repeat(34));
    let big = format!("\"{}\"", "x".repeat(32768));
    for (status, kind, b, expected) in [
        (401, "application/json", "secret", "AUTH"),
        (403, "application/json", "secret", "AUTH"),
        (500, "application/json", "secret", "STATUS"),
        (200, "text/plain", "secret", "CONTENT-TYPE"),
        (200, "application/json", "{bad", "JSON"),
        (200, "application/json", r#"{"x":1,"x":2}"#, "JSON"),
        (200, "application/json", deep.as_str(), "LIMIT"),
        (200, "application/json", big.as_str(), "LIMIT"),
    ] {
        let b = b.to_string();
        let kind = kind.to_string();
        let (u, t) = fixture(move |l| {
            let mut s = accept(&l);
            read(&mut s);
            response(&mut s, status, &kind, "", &b);
        });
        assert_eq!(
            call(u, "GET", json!({})).unwrap_err(),
            format!("BLK-TOOL-HTTP-{expected}")
        );
        t.join().unwrap();
    }
}
#[test]
fn redirect_is_not_followed() {
    let other = TcpListener::bind("127.0.0.1:0").unwrap();
    other.set_nonblocking(true).unwrap();
    let dest = format!(
        "Location: http://{}/stolen\r\n",
        other.local_addr().unwrap()
    );
    let (u, t) = fixture(move |l| {
        let mut s = accept(&l);
        read(&mut s);
        response(&mut s, 302, "application/json", &dest, "{}");
    });
    assert_eq!(
        call(u, "POST", json!({"a":1})).unwrap_err(),
        "BLK-TOOL-HTTP-REDIRECT"
    );
    t.join().unwrap();
    assert!(other.accept().is_err());
}
#[test]
fn cancellation_drops_hanging_body_within_100ms() {
    let ready = Arc::new(AtomicBool::new(false));
    let server_ready = ready.clone();
    let (u, t) = fixture(move |l| {
        let mut s = accept(&l);
        read(&mut s);
        write!(
            s,
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 100\r\n\r\n"
        )
        .unwrap();
        s.flush().unwrap();
        let canceled_at = Instant::now();
        server_ready.store(true, Ordering::SeqCst);
        let mut b = [0];
        assert_eq!(s.read(&mut b).unwrap(), 0);
        assert!(canceled_at.elapsed() < Duration::from_millis(100));
    });
    let canceled_at = std::cell::Cell::new(None);
    let start = Instant::now();
    let e = execute(
        u,
        HeaderMap::new(),
        HttpMode::Loopback,
        "GET",
        &json!({}),
        1000,
        &|| {
            if ready.load(Ordering::SeqCst) {
                canceled_at.set(Some(Instant::now()));
                Err("BLK-CANCELED".into())
            } else {
                Ok(())
            }
        },
    )
    .unwrap_err();
    assert_eq!(e, "BLK-CANCELED");
    assert!(canceled_at.get().unwrap().elapsed() < Duration::from_millis(100));
    assert!(start.elapsed() < Duration::from_secs(1));
    t.join().unwrap();
}
#[test]
fn timeout_drops_pending_headers() {
    let (u, t) = fixture(|l| {
        let mut s = accept(&l);
        read(&mut s);
        let mut b = [0];
        assert_eq!(s.read(&mut b).unwrap(), 0);
    });
    assert_eq!(
        execute(
            u,
            HeaderMap::new(),
            HttpMode::Loopback,
            "POST",
            &json!({}),
            80,
            &|| Ok(())
        )
        .unwrap_err(),
        "BLK-TOOL-HTTP-TIMEOUT"
    );
    t.join().unwrap();
}
#[test]
fn disconnected_post_is_not_retried() {
    let (u, t) = fixture(|l| {
        let mut s = accept(&l);
        read(&mut s);
        drop(s);
        thread::sleep(Duration::from_millis(150));
        assert!(l.accept().is_err());
    });
    assert_eq!(
        call(u, "POST", json!({"n":1})).unwrap_err(),
        "BLK-TOOL-HTTP-TRANSPORT"
    );
    t.join().unwrap();
}

#[test]
fn chunked_json_and_streaming_size_limit() {
    for oversized in [false, true] {
        let (u, t) = fixture(move |l| {
            let mut s = accept(&l);
            read(&mut s);
            write!(s,"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\n\r\n").unwrap();
            let body = if oversized {
                format!("\"{}\"", "x".repeat(32768))
            } else {
                r#"{"city":"城市"}"#.to_string()
            };
            for chunk in body.as_bytes().chunks(8192) {
                write!(s, "{:x}\r\n", chunk.len()).unwrap();
                s.write_all(chunk).unwrap();
                s.write_all(b"\r\n").unwrap();
            }
            s.write_all(b"0\r\n\r\n").unwrap();
            s.flush().unwrap();
        });
        let result = call(u, "GET", json!({}));
        if oversized {
            assert_eq!(result.unwrap_err(), "BLK-TOOL-HTTP-LIMIT");
        } else {
            assert_eq!(result.unwrap(), json!({"city":"城市"}));
        }
        t.join().unwrap();
    }
}

#[test]
fn endpoint_and_timeout_policy_is_shared_without_network() {
    for (url, mode) in [
        ("http://example.test:1234", HttpMode::Remote),
        ("https://127.0.0.1:1234", HttpMode::Remote),
        ("http://localhost:1234", HttpMode::Loopback),
        ("http://127.0.0.2:1234", HttpMode::Loopback),
        ("http://user:secret@127.0.0.1:1234", HttpMode::Loopback),
        ("http://127.0.0.1:1234/#fragment", HttpMode::Loopback),
    ] {
        assert_eq!(
            execute(
                Url::parse(url).unwrap(),
                HeaderMap::new(),
                mode,
                "GET",
                &json!({}),
                1000,
                &|| Ok(())
            )
            .unwrap_err(),
            "BLK-TOOL-HTTP-CONFIG"
        );
    }
    for timeout in [0, 120001] {
        assert_eq!(
            execute(
                Url::parse("http://127.0.0.1:1234").unwrap(),
                HeaderMap::new(),
                HttpMode::Loopback,
                "GET",
                &json!({}),
                timeout,
                &|| Ok(())
            )
            .unwrap_err(),
            "BLK-TOOL-HTTP-CONFIG"
        );
    }
}
