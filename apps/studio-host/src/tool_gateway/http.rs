use crate::mcp_client::http::{HttpMode, HttpTransport};
use reqwest::{header::HeaderMap, Url};
use serde_json::Value;
use std::{
    collections::HashSet,
    time::{Duration, Instant},
};
const LIMIT: usize = 32768;

/// Execute one Host-bound JSON request, without retries or MCP session behavior.
pub(crate) fn execute(
    mut endpoint: Url,
    mut headers: HeaderMap,
    mode: HttpMode,
    method: &str,
    input: &Value,
    timeout_ms: u64,
    cancel: &dyn Fn() -> Result<(), String>,
) -> Result<Value, String> {
    let began = Instant::now();
    cancel()?;
    // Pure validation only; this constructor does not connect or establish a session.
    HttpTransport::new(endpoint.clone(), headers.clone(), mode, timeout_ms)
        .map_err(|_| "BLK-TOOL-HTTP-CONFIG")?;
    crate::mcp_client::validate_json(input, LIMIT).map_err(|_| "BLK-TOOL-HTTP-INPUT-LIMIT")?;
    let method = match method {
        "GET" => {
            let object = input.as_object().ok_or("BLK-TOOL-HTTP-INPUT")?;
            let existing: HashSet<String> = endpoint
                .query_pairs()
                .map(|(k, _)| k.into_owned())
                .collect();
            let mut pairs = Vec::new();
            for (key, value) in object {
                if existing.contains(key) {
                    return Err("BLK-TOOL-HTTP-INPUT".into());
                }
                let value = match value {
                    Value::String(s) => s.clone(),
                    Value::Number(n) => n.to_string(),
                    Value::Bool(b) => b.to_string(),
                    _ => return Err("BLK-TOOL-HTTP-INPUT".into()),
                };
                pairs.push((key.clone(), value));
            }
            if !pairs.is_empty() {
                endpoint.query_pairs_mut().extend_pairs(pairs);
            }
            reqwest::Method::GET
        }
        "POST" => reqwest::Method::POST,
        _ => return Err("BLK-TOOL-HTTP-METHOD".into()),
    };
    for value in headers.values_mut() {
        value.set_sensitive(true);
    }
    let budget = Duration::from_millis(timeout_ms);
    let guard = || {
        cancel()?;
        if began.elapsed() >= budget {
            Err("BLK-TOOL-HTTP-TIMEOUT".into())
        } else {
            Ok(())
        }
    };
    let mut builder = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .retry(reqwest::retry::never())
        .pool_max_idle_per_host(0)
        .connect_timeout(Duration::from_millis(timeout_ms.min(10000)));
    if matches!(mode, HttpMode::Remote) {
        let host = endpoint.host_str().ok_or("BLK-TOOL-HTTP-CONFIG")?;
        let addresses = crate::network_policy::resolve(
            host,
            endpoint
                .port_or_known_default()
                .ok_or("BLK-TOOL-HTTP-CONFIG")?,
            &guard,
        )?;
        builder = builder.https_only(true).resolve_to_addrs(host, &addresses);
    }
    guard()?;
    let client = builder.build().map_err(|_| "BLK-TOOL-HTTP-TRANSPORT")?;
    let mut request = client
        .request(method.clone(), endpoint)
        .headers(headers)
        .header("Accept", "application/json");
    if method == reqwest::Method::POST {
        request = request
            .header("Content-Type", "application/json")
            .body(serde_json::to_vec(input).map_err(|_| "BLK-TOOL-HTTP-INPUT")?);
    }
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|_| "BLK-TOOL-HTTP-TRANSPORT")?;
    let remaining = budget
        .checked_sub(began.elapsed())
        .ok_or("BLK-TOOL-HTTP-TIMEOUT")?;
    runtime.block_on(async {
        let work = async {
            let mut response = request.send().await.map_err(http_error)?;
            let status = response.status();
            if status.is_redirection() {
                return Err("BLK-TOOL-HTTP-REDIRECT".into());
            }
            if [401, 403].contains(&status.as_u16()) {
                return Err("BLK-TOOL-HTTP-AUTH".into());
            }
            if !status.is_success() {
                return Err("BLK-TOOL-HTTP-STATUS".into());
            }
            let types = response
                .headers()
                .get_all("content-type")
                .iter()
                .collect::<Vec<_>>();
            if types.len() != 1 {
                return Err("BLK-TOOL-HTTP-CONTENT-TYPE".into());
            }
            let kind = types[0]
                .to_str()
                .map_err(|_| "BLK-TOOL-HTTP-CONTENT-TYPE")?;
            let mut sections = kind.split(';');
            let mime = sections.next().unwrap_or("").trim().to_ascii_lowercase();
            if mime != "application/json"
                && !(mime.starts_with("application/") && mime.ends_with("+json") && mime.len() > 17)
            {
                return Err("BLK-TOOL-HTTP-CONTENT-TYPE".into());
            }
            for parameter in sections {
                if let Some((name, value)) = parameter.trim().split_once('=') {
                    if name.trim().eq_ignore_ascii_case("charset")
                        && !value.trim().trim_matches('"').eq_ignore_ascii_case("utf-8")
                    {
                        return Err("BLK-TOOL-HTTP-CONTENT-TYPE".into());
                    }
                }
            }
            if response.content_length().is_some_and(|n| n > LIMIT as u64) {
                return Err("BLK-TOOL-HTTP-LIMIT".into());
            }
            let mut bytes = Vec::new();
            while let Some(chunk) = response.chunk().await.map_err(http_error)? {
                if chunk.len() > LIMIT.saturating_sub(bytes.len()) {
                    return Err("BLK-TOOL-HTTP-LIMIT".into());
                }
                bytes.extend_from_slice(&chunk);
            }
            let value = crate::strict_json::parse(&bytes).map_err(|_| "BLK-TOOL-HTTP-JSON")?;
            crate::mcp_client::validate_json(&value, LIMIT).map_err(|_| "BLK-TOOL-HTTP-LIMIT")?;
            Ok(value)
        };
        tokio::pin!(work);
        let deadline = tokio::time::sleep(remaining);
        tokio::pin!(deadline);
        loop {
            tokio::select! {
                biased;
                _=&mut deadline=>return Err("BLK-TOOL-HTTP-TIMEOUT".into()),
                _=tokio::time::sleep(Duration::from_millis(20))=>guard()?,
                result=&mut work=>{guard()?;return result;}
            }
        }
    })
}
fn http_error(error: reqwest::Error) -> String {
    if error.is_timeout() {
        "BLK-TOOL-HTTP-TIMEOUT"
    } else {
        "BLK-TOOL-HTTP-TRANSPORT"
    }
    .into()
}

#[cfg(test)]
#[path = "http_tests.rs"]
mod tests;
