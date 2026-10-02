use super::*;
use serde_json::Value;
use std::{
    collections::HashSet,
    net::{IpAddr, SocketAddr, ToSocketAddrs},
    sync::OnceLock,
    time::{Duration, Instant},
};

fn normalized(name: &str) -> String {
    name.trim_end_matches('.').to_ascii_lowercase()
}
fn decode_answers(body: &[u8], host: &str, port: u16) -> Result<Vec<SocketAddr>, String> {
    if body.len() > 65536 {
        return Err(LIMIT.into());
    }
    let response: Value = serde_json::from_slice(body).map_err(|_| INVALID)?;
    let questions = response["Question"].as_array().ok_or(INVALID)?;
    if response["Status"] != 0
        || questions.len() != 1
        || questions[0]["type"] != 1
        || normalized(questions[0]["name"].as_str().ok_or(INVALID)?) != normalized(host)
    {
        return Err(DENIED.into());
    }
    let answers = response["Answer"].as_array().ok_or(DENIED)?;
    if answers.len() > 64 {
        return Err(LIMIT.into());
    }
    let mut names = HashSet::from([normalized(host)]);
    for _ in 0..16 {
        let before = names.len();
        for answer in answers {
            if answer["type"] == 5
                && names.contains(&normalized(answer["name"].as_str().ok_or(INVALID)?))
            {
                names.insert(normalized(answer["data"].as_str().ok_or(INVALID)?));
            }
        }
        if before == names.len() {
            break;
        }
    }
    let mut addresses = Vec::new();
    for answer in answers {
        if answer["type"] != 1 {
            continue;
        }
        if !names.contains(&normalized(answer["name"].as_str().ok_or(INVALID)?)) {
            return Err(DENIED.into());
        }
        let ip = answer["data"]
            .as_str()
            .ok_or(INVALID)?
            .parse::<IpAddr>()
            .map_err(|_| INVALID)?;
        if !ip.is_ipv4() || !super::public(ip) {
            return Err(DENIED.into());
        }
        addresses.push(SocketAddr::new(ip, port));
    }
    if addresses.is_empty() {
        return Err(DENIED.into());
    }
    addresses.sort();
    addresses.dedup();
    Ok(addresses)
}
fn fake_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v) => v.octets()[0] == 198 && matches!(v.octets()[1], 18 | 19),
        IpAddr::V6(v) => v.segments()[..3] == [0x2001, 2, 0],
    }
}
/// A fixed TLS-authenticated public resolver is consulted only for a synthetic
/// benchmark-range answer. Private/reserved answers are never made connectable.
fn public_fallback(
    host: &str,
    port: u16,
    cancel: &dyn Fn() -> Result<(), String>,
) -> Result<Vec<SocketAddr>, String> {
    let endpoint = reqwest::Url::parse("https://1.1.1.1/dns-query").map_err(|_| INVALID)?;
    query_public_resolver(host, port, endpoint, cancel)
}
struct PublicResolver {
    runtime: tokio::runtime::Runtime,
    client: reqwest::Client,
}
fn public_resolver() -> Result<&'static PublicResolver, String> {
    static RESOLVER: OnceLock<Result<PublicResolver, String>> = OnceLock::new();
    RESOLVER
        .get_or_init(|| {
            // Keep the reactor alive with the client so its pooled connections can
            // serve subsequent turns. DNS answers themselves are never cached here.
            let runtime = tokio::runtime::Builder::new_multi_thread()
                .worker_threads(2)
                .enable_all()
                .build()
                .map_err(|_| "BLK-NETWORK-TRANSPORT".to_owned())?;
            let client = reqwest::Client::builder()
                .no_proxy()
                .redirect(reqwest::redirect::Policy::none())
                .connect_timeout(Duration::from_secs(10))
                .timeout(Duration::from_secs(15))
                .build()
                .map_err(|_| "BLK-NETWORK-TRANSPORT".to_owned())?;
            Ok(PublicResolver { runtime, client })
        })
        .as_ref()
        .map_err(Clone::clone)
}
fn query_public_resolver(
    host: &str,
    port: u16,
    mut endpoint: reqwest::Url,
    cancel: &dyn Fn() -> Result<(), String>,
) -> Result<Vec<SocketAddr>, String> {
    cancel()?;
    let resolver = public_resolver()?;
    endpoint
        .query_pairs_mut()
        .append_pair("name", host)
        .append_pair("type", "A");
    resolver.runtime.block_on(async {
        let interrupted=async {loop {if let Err(error)=cancel(){break error;}tokio::time::sleep(Duration::from_millis(20)).await;}};
        tokio::select! {
            biased;
            error=interrupted=>Err(error),
            result=async {
                let mut response=resolver.client.get(endpoint).header("Accept","application/dns-json").send().await.map_err(|_|"BLK-NETWORK-TRANSPORT")?;
                if !response.status().is_success(){return Err("BLK-NETWORK-TRANSPORT".into());}
                let mut bytes=Vec::new();
                while let Some(chunk)=response.chunk().await.map_err(|_|"BLK-NETWORK-TRANSPORT")? {
                    if bytes.len()+chunk.len()>65536 {return Err(LIMIT.into());}bytes.extend_from_slice(&chunk);
                }
                decode_answers(&bytes,host,port)
            }=>result,
        }
    })
}
pub fn resolve(
    host: &str,
    port: u16,
    cancel: &dyn Fn() -> Result<(), String>,
) -> Result<Vec<SocketAddr>, String> {
    let (tx, rx) = std::sync::mpsc::channel();
    let lookup = host.to_owned();
    std::thread::spawn(move || {
        let result = (lookup.as_str(), port)
            .to_socket_addrs()
            .map(|v| v.collect::<Vec<_>>());
        let _ = tx.send(result);
    });
    let began = Instant::now();
    let addresses = loop {
        cancel()?;
        match rx.recv_timeout(Duration::from_millis(100)) {
            Ok(result) => break result.map_err(|_| "BLK-NETWORK-TRANSPORT")?,
            Err(std::sync::mpsc::RecvTimeoutError::Timeout)
                if began.elapsed() < Duration::from_secs(2) => {}
            _ => return Err("BLK-NETWORK-TIMEOUT".into()),
        }
    };
    if !addresses.is_empty() && addresses.iter().all(|address| fake_ip(address.ip())) {
        return public_fallback(host, port, cancel);
    }
    if addresses.is_empty() || addresses.iter().any(|address| !super::public(address.ip())) {
        return Err(DENIED.into());
    }
    Ok(addresses)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn consecutive_resolver_queries_reuse_one_connection() {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = reqwest::Url::parse(&format!(
            "http://{}/dns-query",
            listener.local_addr().unwrap()
        ))
        .unwrap();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(3)))
                .unwrap();
            for _ in 0..2 {
                let mut request = [0u8; 4096];
                let count = stream.read(&mut request).unwrap();
                assert!(
                    count > 0,
                    "Resolver closed a reusable connection between queries"
                );
                let body = r#"{"Status":0,"Question":[{"name":"example.com.","type":1}],"Answer":[{"name":"example.com.","type":1,"data":"93.184.215.14"}]}"#;
                write!(
                    stream,
                    "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: keep-alive\r\n\r\n{body}",
                    body.len()
                )
                .unwrap();
            }
        });
        let first = query_public_resolver("example.com", 443, url.clone(), &|| Ok(()));
        let second = query_public_resolver("example.com", 443, url, &|| Ok(()));
        let served = server.join();
        assert!(served.is_ok());
        assert!(first.is_ok());
        assert!(second.is_ok());
    }
    fn slow_resolver() -> (reqwest::Url, std::thread::JoinHandle<()>) {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = reqwest::Url::parse(&format!(
            "http://{}/dns-query",
            listener.local_addr().unwrap()
        ))
        .unwrap();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            let mut request = [0u8; 4096];
            let count = stream.read(&mut request).unwrap();
            assert!(String::from_utf8_lossy(&request[..count]).contains("name=example.com"));
            std::thread::sleep(Duration::from_millis(2250));
            let body = r#"{"Status":0,"Question":[{"name":"example.com.","type":1}],"Answer":[{"name":"example.com.","type":1,"data":"93.184.215.14"}]}"#;
            let _ = write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
        });
        (url, server)
    }
    #[test]
    fn public_resolver_accepts_slow_valid_response() {
        let (url, server) = slow_resolver();
        let result = query_public_resolver("example.com", 443, url, &|| Ok(()));
        server.join().unwrap();
        assert_eq!(
            result.unwrap(),
            vec!["93.184.215.14:443".parse::<SocketAddr>().unwrap()]
        );
    }
    #[test]
    fn public_resolver_remains_promptly_cancellable() {
        let (url, server) = slow_resolver();
        let began = Instant::now();
        let result = query_public_resolver("example.com", 443, url, &|| {
            if began.elapsed() >= Duration::from_millis(100) {
                Err("BLK-CANCELLED".into())
            } else {
                Ok(())
            }
        });
        let elapsed = began.elapsed();
        server.join().unwrap();
        assert_eq!(result.unwrap_err(), "BLK-CANCELLED");
        assert!(elapsed < Duration::from_secs(1));
    }
    #[test]
    fn dual_stack_benchmark_answers_use_authenticated_fallback_without_admitting_private_ranges() {
        for ip in ["198.18.1.68", "2001:2::13c"] {
            let ip = ip.parse().unwrap();
            assert!(fake_ip(ip));
            assert!(!super::super::public(ip));
        }
        for ip in [
            "127.0.0.1",
            "10.0.0.1",
            "::1",
            "fd00::1",
            "2001:db8::1",
            "2001:2:1::1",
        ] {
            assert!(!fake_ip(ip.parse().unwrap()));
        }
    }
    #[test]
    fn authenticated_dns_answers_must_match_question_and_only_resolve_public_cname_chain() {
        let response = json!({"Status":0,"Question":[{"name":"example.com.","type":1}],"Answer":[{"name":"example.com.","type":5,"data":"edge.example.net."},{"name":"edge.example.net.","type":1,"data":"93.184.215.14"}]});
        let body = serde_json::to_vec(&response).unwrap();
        assert_eq!(
            decode_answers(&body, "example.com", 443).unwrap()[0]
                .ip()
                .to_string(),
            "93.184.215.14"
        );
        assert!(decode_answers(&body, "another.example", 443).is_err());
        let mut private = response.clone();
        private["Answer"][1]["data"] = json!("127.0.0.1");
        assert!(
            decode_answers(&serde_json::to_vec(&private).unwrap(), "example.com", 443).is_err()
        );
        private["Answer"][1]["data"] = json!("198.18.0.1");
        assert!(
            decode_answers(&serde_json::to_vec(&private).unwrap(), "example.com", 443).is_err()
        );
        let mut unrelated = response;
        unrelated["Answer"][1]["name"] = json!("unrelated.example");
        assert!(
            decode_answers(&serde_json::to_vec(&unrelated).unwrap(), "example.com", 443).is_err()
        );
    }
}
