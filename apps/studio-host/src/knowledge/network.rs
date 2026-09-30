use super::*;
use reqwest::{Url, blocking::Client};
use serde_json::{Value, json};
use std::{io::Read, net::IpAddr, time::Duration};
pub struct Fetched {
    pub bytes: Vec<u8>,
    pub url: String,
    pub html: bool,
    pub metadata: Value,
}
use crate::network_policy::public;
pub fn validate_url(input: &str) -> Result<Url, String> {
    if input.len() > 4096 {
        return Err(INVALID.into());
    }
    let url = Url::parse(input).map_err(|_| INVALID)?;
    if !["http", "https"].contains(&url.scheme())
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
        || url.query().is_some()
    {
        return Err(DENIED.into());
    }
    let host = url.host_str().ok_or(INVALID)?.trim_matches(['[', ']']);
    if host.eq_ignore_ascii_case("localhost")
        || host.ends_with(".localhost")
        || host.ends_with(".local")
        || host.ends_with(".internal")
        || !host.contains('.') && !host.contains(':')
    {
        return Err(DENIED.into());
    }
    if let Ok(ip) = host.parse::<IpAddr>() {
        if !public(ip) {
            return Err(DENIED.into());
        }
    }
    Ok(url)
}
pub fn fetch(input: &str, previous: Option<&Document>) -> Result<Fetched, String> {
    fetch_impl(input, previous, Transport::Public)
}
enum Transport {
    Public,
    #[cfg(test)]
    Loopback(std::net::SocketAddr),
}
fn fetch_impl(
    input: &str,
    previous: Option<&Document>,
    transport: Transport,
) -> Result<Fetched, String> {
    let mut url = validate_url(input)?;
    for _ in 0..6 {
        super::cancel::check()?;
        let host = url
            .host_str()
            .ok_or(INVALID)?
            .trim_matches(['[', ']'])
            .to_owned();
        let port = url.port_or_known_default().ok_or(INVALID)?;
        let addresses = match transport {
            #[cfg(test)]
            Transport::Loopback(address) => vec![address],
            Transport::Public => super::dns::resolve(&host, port)?,
        };
        let client = Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(3))
            .connect_timeout(Duration::from_secs(2))
            .resolve_to_addrs(&host, &addresses)
            .build()
            .map_err(|_| "BLK-KNOW-NETWORK")?;
        super::cancel::check()?;
        let mut request = client.get(url.clone()).header(
            "Accept",
            "text/plain,text/html,text/markdown,application/json",
        );
        let matching_previous =
            previous.filter(|doc| doc.locator["url"].as_str() == Some(url.as_str()));
        if let Some(previous) = matching_previous {
            if let Some(etag) = previous.metadata["etag"].as_str() {
                request = request.header(reqwest::header::IF_NONE_MATCH, etag);
            }
            if let Some(modified) = previous.metadata["lastModified"].as_str() {
                request = request.header(reqwest::header::IF_MODIFIED_SINCE, modified);
            }
        }
        let response = request.send().map_err(|_| "BLK-KNOW-NETWORK")?;
        super::cancel::check()?;
        if response.status() == reqwest::StatusCode::NOT_MODIFIED {
            let previous = matching_previous.ok_or(INVALID)?;
            return Ok(Fetched {
                bytes: previous.text.as_bytes().to_vec(),
                url: url.as_str().into(),
                html: previous.format == "html",
                metadata: previous.metadata.clone(),
            });
        }
        if response.status().is_redirection() {
            let location = response
                .headers()
                .get(reqwest::header::LOCATION)
                .ok_or(INVALID)?
                .to_str()
                .map_err(|_| INVALID)?;
            url = validate_url(url.join(location).map_err(|_| INVALID)?.as_str())?;
            continue;
        }
        if !response.status().is_success() {
            return Err("BLK-KNOW-HTTP".into());
        }
        let content_type = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_ascii_lowercase();
        if ![
            "text/plain",
            "text/html",
            "text/markdown",
            "application/json",
            "application/xhtml+xml",
        ]
        .iter()
        .any(|t| content_type.split(';').next() == Some(*t))
        {
            return Err("BLK-KNOW-FORMAT".into());
        }
        if response
            .content_length()
            .is_some_and(|n| n > MAX_DOCUMENT as u64)
        {
            return Err(LIMIT.into());
        }
        let mut metadata = json!({"etag":response.headers().get(reqwest::header::ETAG).and_then(|v|v.to_str().ok()),"lastModified":response.headers().get(reqwest::header::LAST_MODIFIED).and_then(|v|v.to_str().ok()),"contentType":content_type});
        if let Some(map) = metadata.as_object_mut() {
            map.retain(|_, v| !v.is_null());
        }
        let mut bytes = Vec::new();
        response
            .take(MAX_DOCUMENT as u64 + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| "BLK-KNOW-NETWORK")?;
        if bytes.len() > MAX_DOCUMENT {
            return Err(LIMIT.into());
        }
        return Ok(Fetched {
            bytes,
            url: url.as_str().into(),
            html: content_type.contains("html"),
            metadata,
        });
    }
    Err("BLK-KNOW-REDIRECT".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::{Read, Write},
        net::TcpListener,
    };
    fn server(
        responses: Vec<String>,
    ) -> (std::net::SocketAddr, std::thread::JoinHandle<Vec<String>>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let handle = std::thread::spawn(move || {
            responses
                .into_iter()
                .map(|response| {
                    let (mut stream, _) = listener.accept().unwrap();
                    stream
                        .set_read_timeout(Some(Duration::from_secs(2)))
                        .unwrap();
                    let mut input = vec![0u8; 8192];
                    let count = stream.read(&mut input).unwrap();
                    let request = String::from_utf8_lossy(&input[..count]).into_owned();
                    stream.write_all(response.as_bytes()).unwrap();
                    request
                })
                .collect()
        });
        (address, handle)
    }
    #[test]
    fn conditional_http_reuses_only_verified_previous_document() {
        let (address,handle)=server(vec!["HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nETag: \"version1\"\r\nContent-Length: 5\r\nConnection: close\r\n\r\nhello".into(),"HTTP/1.1 304 Not Modified\r\nConnection: close\r\n\r\n".into()]);
        let url = format!("http://example.org:{}/page", address.port());
        let first = fetch_impl(&url, None, Transport::Loopback(address)).unwrap();
        assert_eq!(first.bytes, b"hello");
        let previous = Document {
            document_id: "d".into(),
            title: "page".into(),
            locator: json!({"url":url}),
            format: "text".into(),
            text: "hello".into(),
            revision: digest(b"hello"),
            metadata: first.metadata,
        };
        let second = fetch_impl(&url, Some(&previous), Transport::Loopback(address)).unwrap();
        assert_eq!(second.bytes, b"hello");
        let requests = handle.join().unwrap();
        assert!(
            requests[1]
                .to_ascii_lowercase()
                .contains("if-none-match: \"version1\"")
        );
    }
    #[test]
    fn redirects_to_private_targets_and_oversize_responses_are_rejected() {
        let (address,handle)=server(vec!["HTTP/1.1 302 Found\r\nLocation: http://127.0.0.1/private\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".into()]);
        let url = format!("http://example.org:{}/page", address.port());
        assert!(
            matches!(fetch_impl(&url,None,Transport::Loopback(address)),Err(code) if code==DENIED)
        );
        handle.join().unwrap();
        let (address,handle)=server(vec!["HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 3000000\r\nConnection: close\r\n\r\n".into()]);
        let url = format!("http://example.org:{}/page", address.port());
        assert!(
            matches!(fetch_impl(&url,None,Transport::Loopback(address)),Err(code) if code==LIMIT)
        );
        handle.join().unwrap();
    }
}
