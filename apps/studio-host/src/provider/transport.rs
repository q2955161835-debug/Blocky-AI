use super::types::*;
use serde_json::{Value, json};
use std::{
    sync::atomic::{AtomicBool, Ordering},
    time::Duration,
};
pub fn status(code: u16) -> Result<(), String> {
    match code {
        200 => Ok(()),
        401 | 403 => Err("BLK-PROVIDER-AUTH".into()),
        429 => Err("BLK-PROVIDER-RATE".into()),
        500..=599 => Err("BLK-PROVIDER-SERVICE".into()),
        _ => Err("BLK-PROVIDER-HTTP".into()),
    }
}
pub fn parse(bytes: &[u8], max: u32) -> Result<Value, String> {
    let error = "BLK-PROVIDER-RESPONSE";
    let v = crate::strict_json::parse(bytes).map_err(|_| error)?;
    let text = v["choices"][0]["message"]["content"]
        .as_str()
        .filter(|s| !s.trim().is_empty() && s.len() <= 65536)
        .ok_or(error)?;
    if v["choices"].as_array().is_none_or(|a| a.len() != 1)
        || v["choices"][0]["finish_reason"] != "stop"
        || v["choices"][0]["message"]["role"] != "assistant"
    {
        return Err(error.into());
    }
    let model = v["model"]
        .as_str()
        .filter(|s| !s.is_empty() && s.len() <= 128 && !s.chars().any(char::is_control))
        .ok_or(error)?;
    let id = v["id"]
        .as_str()
        .filter(|s| !s.is_empty() && s.len() <= 256 && !s.chars().any(char::is_control))
        .ok_or(error)?;
    let input = v["usage"]["prompt_tokens"].as_u64().ok_or(error)?;
    let output = v["usage"]["completion_tokens"].as_u64().ok_or(error)?;
    let total = v["usage"]["total_tokens"].as_u64().ok_or(error)?;
    if output > max as u64 || input > 10_000_000 || input.checked_add(output) != Some(total) {
        return Err(error.into());
    }
    Ok(
        json!({"text":text,"model":model,"requestId":id,"usage":{"inputTokens":input,"outputTokens":output,"totalTokens":total},"provider":"deepseek","transport":"remote"}),
    )
}
#[cfg(test)]
pub fn consume(mut reader: impl std::io::Read, cancel: &AtomicBool) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    let mut chunk = [0u8; 8192];
    loop {
        if cancel.load(Ordering::SeqCst) {
            return Err("BLK-PROVIDER-CANCELLED".into());
        }
        let n = reader.read(&mut chunk).map_err(|e| {
            if e.kind() == std::io::ErrorKind::TimedOut
                || e.get_ref()
                    .and_then(|e| e.downcast_ref::<reqwest::Error>())
                    .is_some_and(|e| e.is_timeout())
            {
                "BLK-PROVIDER-TIMEOUT"
            } else {
                "BLK-PROVIDER-TRANSPORT"
            }
        })?;
        if n == 0 {
            break;
        }
        if bytes.len() + n > 262144 {
            return Err("BLK-PROVIDER-LIMIT".into());
        }
        bytes.extend_from_slice(&chunk[..n]);
    }
    if cancel.load(Ordering::SeqCst) {
        return Err("BLK-PROVIDER-CANCELLED".into());
    }
    Ok(bytes)
}
pub fn send(r: &ProviderRequest, key: &[u8], cancel: &AtomicBool) -> Result<Value, String> {
    r.validate()?;
    let bytes = send_raw_observed(
        r.endpoint(),
        &r.body(),
        r.timeout_ms,
        key,
        cancel,
        &mut || Ok(()),
    )?;
    let mut result = parse(&bytes, r.max_output_tokens)?;
    result["provider"] = json!(r.provider_name());
    Ok(result)
}
pub(crate) fn send_raw_observed(
    endpoint: &'static str,
    body: &Value,
    timeout_ms: u64,
    key: &[u8],
    cancel: &AtomicBool,
    before_send: &mut dyn FnMut() -> Result<(), String>,
) -> Result<Vec<u8>, String> {
    if ![ENDPOINT, XIRANG_ENDPOINT].contains(&endpoint) {
        return Err("BLK-PROVIDER-CONFIG".into());
    }
    if cancel.load(Ordering::SeqCst) {
        return Err("BLK-PROVIDER-CANCELLED".into());
    }
    let key = std::str::from_utf8(key).map_err(|_| "BLK-PROVIDER-CONFIG")?;
    let client = reqwest::Client::builder()
        .https_only(true)
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_millis(timeout_ms))
        .connect_timeout(Duration::from_millis(timeout_ms.min(10000)))
        .build()
        .map_err(|_| "BLK-PROVIDER-TRANSPORT")?;
    exchange_using(client, endpoint, body, timeout_ms, key, cancel, before_send)
}
pub(crate) fn exchange_using(
    client: reqwest::Client,
    endpoint: &str,
    body: &Value,
    timeout_ms: u64,
    key: &str,
    cancel: &AtomicBool,
    before_send: &mut dyn FnMut() -> Result<(), String>,
) -> Result<Vec<u8>, String> {
    exchange_headers_using(
        client,
        endpoint,
        body,
        timeout_ms,
        key,
        None,
        cancel,
        before_send,
    )
}
pub(crate) fn exchange_headers_using(
    client: reqwest::Client,
    endpoint: &str,
    body: &Value,
    timeout_ms: u64,
    key: &str,
    headers: Option<&reqwest::header::HeaderMap>,
    cancel: &AtomicBool,
    before_send: &mut dyn FnMut() -> Result<(), String>,
) -> Result<Vec<u8>, String> {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|_| "BLK-PROVIDER-TRANSPORT")?;
    runtime.block_on(async {
        // Dropping the losing request/body future closes its connection when cancellation wins.
        let cancelled=async {
            loop {
                if cancel.load(Ordering::SeqCst){break;}
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
        };
        tokio::select! {
            biased;
            _=cancelled=>Err("BLK-PROVIDER-CANCELLED".into()),
            _=tokio::time::sleep(Duration::from_millis(timeout_ms))=>Err("BLK-PROVIDER-TIMEOUT".into()),
            result=exchange(client,endpoint,body,key,headers,before_send)=>result,
        }
    })
}
async fn exchange(
    client: reqwest::Client,
    endpoint: &str,
    body: &Value,
    key: &str,
    headers: Option<&reqwest::header::HeaderMap>,
    before_send: &mut dyn FnMut() -> Result<(), String>,
) -> Result<Vec<u8>, String> {
    let mut request = client
        .post(endpoint)
        .header("Content-Type", "application/json")
        .body(body.to_string());
    if !key.is_empty() {
        request = request.bearer_auth(key);
    }
    if let Some(headers) = headers {
        request = request.headers(headers.clone());
    }
    let request = request.build().map_err(|_| "BLK-PROVIDER-CONFIG")?;
    before_send()?;
    let mut response = client.execute(request).await.map_err(|e| {
        if e.is_timeout() {
            "BLK-PROVIDER-TIMEOUT"
        } else {
            "BLK-PROVIDER-TRANSPORT"
        }
    })?;
    status(response.status().as_u16())?;
    if response.content_length().is_some_and(|n| n > 262144) {
        return Err("BLK-PROVIDER-LIMIT".into());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|e| {
        if e.is_timeout() {
            "BLK-PROVIDER-TIMEOUT"
        } else {
            "BLK-PROVIDER-TRANSPORT"
        }
    })? {
        if bytes.len() + chunk.len() > 262144 {
            return Err("BLK-PROVIDER-LIMIT".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}
#[cfg(test)]
pub(super) fn mock_send(
    endpoint: &str,
    r: &ProviderRequest,
    cancel: &AtomicBool,
) -> Result<Value, String> {
    let client = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_millis(r.timeout_ms))
        .build()
        .unwrap();
    let bytes = exchange_using(
        client,
        endpoint,
        &r.body(),
        r.timeout_ms,
        "synthetic-test-key",
        cancel,
        &mut || Ok(()),
    )?;
    parse(&bytes, r.max_output_tokens)
}

#[cfg(test)]
mod observation_tests {
    use super::*;
    #[test]
    fn rejected_preflight_never_marks_network_attempted() {
        for (cancelled, key) in [(true, b"synthetic".as_slice()), (false, &[255u8][..])] {
            let mut observed = false;
            let result = send_raw_observed(
                ENDPOINT,
                &json!({}),
                100,
                key,
                &AtomicBool::new(cancelled),
                &mut || {
                    observed = true;
                    Ok(())
                },
            );
            assert!(result.is_err());
            assert!(!observed);
        }
    }
}
