use super::*;
use serde_json::Value;
use std::{
    collections::HashSet,
    io::Read,
    net::{IpAddr, SocketAddr, ToSocketAddrs},
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
        if !ip.is_ipv4() || !super::network::public(ip) {
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
    matches!(ip,IpAddr::V4(v) if v.octets()[0]==198 && matches!(v.octets()[1],18|19))
}
/// A fixed TLS-authenticated public resolver is consulted only for a synthetic
/// benchmark-range answer. Private/reserved answers are never made connectable.
fn public_fallback(host: &str, port: u16) -> Result<Vec<SocketAddr>, String> {
    super::cancel::check()?;
    let client = reqwest::blocking::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(2))
        .build()
        .map_err(|_| "BLK-KNOW-NETWORK")?;
    let mut endpoint = reqwest::Url::parse("https://1.1.1.1/dns-query").map_err(|_| INVALID)?;
    endpoint.query_pairs_mut().append_pair("name", host).append_pair("type", "A");
    let response = client
        .get(endpoint)
        .header("Accept", "application/dns-json")
        .send()
        .map_err(|_| "BLK-KNOW-NETWORK")?;
    if !response.status().is_success() {
        return Err("BLK-KNOW-NETWORK".into());
    }
    let mut bytes = Vec::new();
    response
        .take(65537)
        .read_to_end(&mut bytes)
        .map_err(|_| "BLK-KNOW-NETWORK")?;
    super::cancel::check()?;
    decode_answers(&bytes, host, port)
}
pub fn resolve(host: &str, port: u16) -> Result<Vec<SocketAddr>, String> {
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
        super::cancel::check()?;
        match rx.recv_timeout(Duration::from_millis(100)) {
            Ok(result) => break result.map_err(|_| "BLK-KNOW-NETWORK")?,
            Err(std::sync::mpsc::RecvTimeoutError::Timeout)
                if began.elapsed() < Duration::from_secs(2) => {}
            _ => return Err("BLK-KNOW-TIMEOUT".into()),
        }
    };
    if !addresses.is_empty() && addresses.iter().all(|address| fake_ip(address.ip())) {
        return public_fallback(host, port);
    }
    if addresses.is_empty()
        || addresses
            .iter()
            .any(|address| !super::network::public(address.ip()))
    {
        return Err(DENIED.into());
    }
    Ok(addresses)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
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
