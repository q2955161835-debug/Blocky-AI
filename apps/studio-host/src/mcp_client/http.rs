//! Host-bound Streamable HTTP; no reconnect, replay, background GET or Host callbacks.
use super::Transport;
use reqwest::{
    header::{HeaderMap, HeaderValue},
    Url,
};
use serde_json::{json, Value};
use std::{
    net::IpAddr,
    time::{Duration, Instant},
};
const FRAME: usize = 262144;
const TOTAL: usize = 1048576;
const PROTOCOL: &str = "BLK-MCP-PROTOCOL";
#[derive(Clone, Copy)]
pub enum HttpMode {
    Remote,
    Loopback,
}
pub struct HttpTransport {
    endpoint: Url,
    headers: HeaderMap,
    mode: HttpMode,
    timeout_ms: u64,
    client: Option<reqwest::Client>,
    session: Option<HeaderValue>,
    version: Option<HeaderValue>,
    expired: bool,
    closed: bool,
}
impl HttpTransport {
    pub fn new(
        endpoint: Url,
        mut headers: HeaderMap,
        mode: HttpMode,
        timeout_ms: u64,
    ) -> Result<Self, String> {
        if !(1..=120000).contains(&timeout_ms)
            || endpoint.as_str().len() > 4096
            || !endpoint.username().is_empty()
            || endpoint.password().is_some()
            || endpoint.fragment().is_some()
        {
            return Err("BLK-MCP-CONFIG".into());
        }
        let host = endpoint.host_str().ok_or("BLK-MCP-ENDPOINT")?;
        let ip = host.trim_matches(['[', ']']).parse::<IpAddr>().ok();
        match mode {
            HttpMode::Remote
                if endpoint.scheme() != "https"
                    || ip.is_some_and(|v| !crate::network_policy::public(v)) =>
            {
                return Err("BLK-MCP-ENDPOINT".into());
            }
            HttpMode::Loopback
                if !["http", "https"].contains(&endpoint.scheme())
                    || !ip.is_some_and(|v| {
                        v == "127.0.0.1".parse::<IpAddr>().unwrap()
                            || v == "::1".parse::<IpAddr>().unwrap()
                    })
                    || !endpoint.port().is_some_and(|port| port > 0) =>
            {
                return Err("BLK-MCP-ENDPOINT".into());
            }
            _ => {}
        }
        if headers.len() > 32 {
            return Err("BLK-MCP-HEADERS".into());
        }
        if headers
            .keys()
            .any(|name| headers.get_all(name).iter().count() > 1)
        {
            return Err("BLK-MCP-HEADERS".into());
        }
        let mut bytes = 0;
        for (name, value) in headers.iter_mut() {
            if [
                "host",
                "connection",
                "content-length",
                "transfer-encoding",
                "proxy-authorization",
                "proxy-connection",
                "accept",
                "content-type",
                "mcp-session-id",
                "mcp-protocol-version",
                "upgrade",
                "te",
                "trailer",
                "origin",
                "content-encoding",
                "expect",
                "keep-alive",
            ]
            .contains(&name.as_str())
                || !visible(value.as_bytes(), true)
            {
                return Err("BLK-MCP-HEADERS".into());
            }
            bytes += name.as_str().len() + value.as_bytes().len();
            if bytes > 8192 || value.as_bytes().len() > 4096 {
                return Err("BLK-MCP-HEADERS".into());
            }
            value.set_sensitive(true);
        }
        Ok(Self {
            endpoint,
            headers,
            mode,
            timeout_ms,
            client: None,
            session: None,
            version: None,
            expired: false,
            closed: false,
        })
    }
    fn connect(&mut self, cancel: &dyn Fn() -> Result<(), String>) -> Result<(), String> {
        if self.client.is_some() {
            return Ok(());
        }
        let mut builder = reqwest::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .retry(reqwest::retry::never())
            .pool_max_idle_per_host(0)
            .connect_timeout(Duration::from_millis(self.timeout_ms.min(10000)));
        if matches!(self.mode, HttpMode::Remote) {
            let host = self.endpoint.host_str().ok_or("BLK-MCP-ENDPOINT")?;
            let addresses = crate::network_policy::resolve(
                host,
                self.endpoint
                    .port_or_known_default()
                    .ok_or("BLK-MCP-ENDPOINT")?,
                cancel,
            )?;
            builder = builder.https_only(true).resolve_to_addrs(host, &addresses);
        }
        cancel()?;
        self.client = Some(builder.build().map_err(|_| "BLK-MCP-TRANSPORT")?);
        Ok(())
    }
    fn request(&self, method: reqwest::Method) -> reqwest::RequestBuilder {
        let mut request = self
            .client
            .as_ref()
            .unwrap()
            .request(method, self.endpoint.clone())
            .headers(self.headers.clone())
            .header("Accept", "application/json, text/event-stream");
        if let Some(sid) = &self.session {
            request = request.header("Mcp-Session-Id", sid.clone());
        }
        if let Some(version) = &self.version {
            request = request.header("Mcp-Protocol-Version", version.clone());
        }
        request
    }
    fn status(&mut self, response: &reqwest::Response) -> Result<(), String> {
        let code = response.status().as_u16();
        if code == 404 && self.session.is_some() {
            self.expired = true;
            self.session = None;
            return Err("BLK-MCP-SESSION-EXPIRED".into());
        }
        if response.status().is_redirection() {
            return Err("BLK-MCP-REDIRECT".into());
        }
        if !response.status().is_success() {
            return Err("BLK-MCP-HTTP".into());
        }
        Ok(())
    }
    fn session(&mut self, response: &reqwest::Response, initialize: bool) -> Result<(), String> {
        let values = response
            .headers()
            .get_all("mcp-session-id")
            .iter()
            .collect::<Vec<_>>();
        if values.len() > 1 {
            return Err("BLK-MCP-SESSION".into());
        }
        if let Some(value) = values.first() {
            if value.as_bytes().len() > 4096 || !visible(value.as_bytes(), false) {
                return Err("BLK-MCP-SESSION".into());
            }
            if let Some(old) = &self.session {
                if old != *value {
                    return Err("BLK-MCP-SESSION".into());
                }
            } else if initialize {
                let mut value = (*value).clone();
                value.set_sensitive(true);
                self.session = Some(value);
            } else {
                return Err("BLK-MCP-SESSION".into());
            }
        }
        Ok(())
    }
    async fn empty(mut response: reqwest::Response) -> Result<(), String> {
        while let Some(bytes) = response.chunk().await.map_err(http_error)? {
            if !bytes.is_empty() {
                return Err(PROTOCOL.into());
            }
        }
        Ok(())
    }
    async fn reject(&mut self, id: Value) -> Result<(), String> {
        let body = serde_json::to_vec(
            &json!({"jsonrpc":"2.0","id":id,"error":{"code":-32601,"message":"Method not found"}}),
        )
        .map_err(|_| PROTOCOL)?;
        if body.len() > FRAME {
            return Err("BLK-MCP-LIMIT".into());
        }
        let response = self
            .request(reqwest::Method::POST)
            .header("Content-Type", "application/json")
            .body(body)
            .send()
            .await
            .map_err(http_error)?;
        self.status(&response)?;
        self.session(&response, false)?;
        if response.status().as_u16() != 202 {
            return Err(PROTOCOL.into());
        }
        Self::empty(response).await
    }
    async fn post(&mut self, message: &Value, body: Vec<u8>) -> Result<Option<Value>, String> {
        let expected = message.get("method").and_then(|_| message.get("id"));
        let mut response = self
            .request(reqwest::Method::POST)
            .header("Content-Type", "application/json")
            .body(body)
            .send()
            .await
            .map_err(http_error)?;
        self.status(&response)?;
        self.session(&response, message["method"] == "initialize")?;
        if expected.is_none() {
            if response.status().as_u16() != 202 {
                return Err(PROTOCOL.into());
            }
            Self::empty(response).await?;
            return Ok(None);
        }
        if response.status().as_u16() != 200 {
            return Err(PROTOCOL.into());
        }
        let types = response
            .headers()
            .get_all("content-type")
            .iter()
            .collect::<Vec<_>>();
        if types.len() != 1 {
            return Err("BLK-MCP-CONTENT-TYPE".into());
        }
        let kind = types[0]
            .to_str()
            .map_err(|_| "BLK-MCP-CONTENT-TYPE")?
            .to_ascii_lowercase();
        for parameter in kind.split(';').skip(1) {
            if let Some(charset) = parameter.trim().strip_prefix("charset=") {
                if charset.trim_matches('"') != "utf-8" {
                    return Err("BLK-MCP-CONTENT-TYPE".into());
                }
            }
        }
        match kind.split(';').next().unwrap().trim() {
            "application/json" => {
                let mut bytes = Vec::new();
                while let Some(chunk) = response.chunk().await.map_err(http_error)? {
                    if bytes.len() + chunk.len() > FRAME {
                        return Err("BLK-MCP-LIMIT".into());
                    }
                    bytes.extend_from_slice(&chunk);
                }
                let value: Value = serde_json::from_slice(&bytes).map_err(|_| PROTOCOL)?;
                match incoming(value, expected.unwrap())? {
                    Incoming::Reply(value) => Ok(Some(value)),
                    Incoming::Reverse(id) => {
                        self.reject(id).await?;
                        Err(PROTOCOL.into())
                    }
                    Incoming::Notification => Err(PROTOCOL.into()),
                }
            }
            "text/event-stream" => {
                let mut parser = Frames::default();
                let mut notices = 0;
                while let Some(chunk) = response.chunk().await.map_err(http_error)? {
                    for value in parser.feed(&chunk)? {
                        match incoming(value, expected.unwrap())? {
                            Incoming::Reply(value) => return Ok(Some(value)),
                            Incoming::Notification => {
                                notices += 1;
                            }
                            Incoming::Reverse(id) => {
                                notices += 1;
                                if notices > 64 {
                                    return Err("BLK-MCP-LIMIT".into());
                                }
                                self.reject(id).await?;
                            }
                        }
                        if notices > 64 {
                            return Err("BLK-MCP-LIMIT".into());
                        }
                    }
                }
                Err(PROTOCOL.into())
            }
            _ => Err("BLK-MCP-CONTENT-TYPE".into()),
        }
    }
}
fn visible(bytes: &[u8], space: bool) -> bool {
    !bytes.is_empty()
        && bytes
            .iter()
            .all(|v| *v >= if space { 0x20 } else { 0x21 } && *v <= 0x7e)
}
fn http_error(error: reqwest::Error) -> String {
    if error.is_timeout() {
        "BLK-MCP-TIMEOUT"
    } else {
        "BLK-MCP-TRANSPORT"
    }
    .into()
}
fn id(value: &Value) -> bool {
    value.is_string() || value.is_i64() || value.is_u64()
}
enum Incoming {
    Reply(Value),
    Notification,
    Reverse(Value),
}
fn incoming(value: Value, expected: &Value) -> Result<Incoming, String> {
    if !value.is_object() || value["jsonrpc"] != "2.0" {
        return Err(PROTOCOL.into());
    }
    if let Some(method) = value.get("method") {
        if !method
            .as_str()
            .is_some_and(|s| !s.is_empty() && s.len() <= 256)
            || value.get("result").is_some()
            || value.get("error").is_some()
        {
            return Err(PROTOCOL.into());
        }
        return match value.get("id") {
            Some(v) if id(v) => Ok(Incoming::Reverse(v.clone())),
            None => Ok(Incoming::Notification),
            _ => Err(PROTOCOL.into()),
        };
    }
    if value.get("id") != Some(expected)
        || value.get("result").is_some() == value.get("error").is_some()
    {
        return Err(PROTOCOL.into());
    }
    Ok(Incoming::Reply(value))
}
#[derive(Default)]
struct Frames {
    pending: Vec<u8>,
    data: Vec<String>,
    frame: usize,
    total: usize,
    first: bool,
    messages: usize,
}
impl Frames {
    fn feed(&mut self, bytes: &[u8]) -> Result<Vec<Value>, String> {
        self.total = self.total.checked_add(bytes.len()).ok_or("BLK-MCP-LIMIT")?;
        if self.total > TOTAL {
            return Err("BLK-MCP-LIMIT".into());
        }
        self.pending.extend_from_slice(bytes);
        let mut frames = Vec::new();
        let mut consumed = 0;
        while let Some(offset) = self.pending[consumed..].iter().position(|v| *v == b'\n') {
            let end = consumed + offset;
            self.frame += end - consumed + 1;
            if self.frame > FRAME {
                return Err("BLK-MCP-LIMIT".into());
            }
            let mut raw = &self.pending[consumed..end];
            if raw.last() == Some(&b'\r') {
                raw = &raw[..raw.len() - 1];
            }
            let mut line = std::str::from_utf8(raw).map_err(|_| PROTOCOL)?;
            if !self.first {
                line = line.strip_prefix('\u{feff}').unwrap_or(line);
                self.first = true;
            }
            if line.is_empty() {
                let data = self.data.join("\n");
                if !data.is_empty() {
                    self.messages += 1;
                    if self.messages > 65 {
                        return Err("BLK-MCP-LIMIT".into());
                    }
                    frames.push(serde_json::from_str(&data).map_err(|_| PROTOCOL)?);
                }
                self.data.clear();
                self.frame = 0;
            } else if let Some(data) = line.strip_prefix("data:") {
                self.data
                    .push(data.strip_prefix(' ').unwrap_or(data).to_owned());
            } else if line == "data" {
                self.data.push(String::new());
            }
            consumed = end + 1;
        }
        self.pending.drain(..consumed);
        if self.frame + self.pending.len() > FRAME {
            return Err("BLK-MCP-LIMIT".into());
        }
        Ok(frames)
    }
}
impl Transport for HttpTransport {
    fn exchange(
        &mut self,
        message: &Value,
        cancel: &dyn Fn() -> Result<(), String>,
    ) -> Result<Option<Value>, String> {
        cancel()?;
        if self.expired {
            return Err("BLK-MCP-SESSION-EXPIRED".into());
        }
        if self.closed {
            return Err("BLK-MCP-CLOSED".into());
        }
        if !message.is_object()
            || message["jsonrpc"] != "2.0"
            || message.get("id").is_some_and(|v| !id(v))
            || message.get("method").is_some_and(|method| {
                !method
                    .as_str()
                    .is_some_and(|s| !s.is_empty() && s.len() <= 256)
                    || message.get("result").is_some()
                    || message.get("error").is_some()
            })
            || (message.get("method").is_none()
                && (message.get("result").is_some() == message.get("error").is_some()))
        {
            return Err(PROTOCOL.into());
        }
        let body = serde_json::to_vec(message).map_err(|_| PROTOCOL)?;
        if body.len() > FRAME {
            return Err("BLK-MCP-LIMIT".into());
        }
        let began = Instant::now();
        let timeout_ms = self.timeout_ms;
        let guarded = || {
            cancel()?;
            if began.elapsed() >= Duration::from_millis(timeout_ms) {
                Err("BLK-MCP-TIMEOUT".into())
            } else {
                Ok(())
            }
        };
        self.connect(&guarded)?;
        let remaining = Duration::from_millis(self.timeout_ms).saturating_sub(began.elapsed());
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .map_err(|_| "BLK-MCP-TRANSPORT")?;
        runtime.block_on(async{let cancelled=async{loop{if let Err(error)=cancel(){return error;}tokio::time::sleep(Duration::from_millis(20)).await;}};tokio::select!{biased;error=cancelled=>Err(error),_=tokio::time::sleep(remaining)=>Err("BLK-MCP-TIMEOUT".into()),result=self.post(message,body)=>result}})
    }
    fn negotiated(&mut self, version: &str) -> Result<(), String> {
        if !["2025-11-25", "2025-06-18", "2025-03-26"].contains(&version) {
            return Err("BLK-MCP-VERSION".into());
        }
        if self.version.is_some() {
            return Err(PROTOCOL.into());
        }
        self.version = Some(HeaderValue::from_str(version).map_err(|_| PROTOCOL)?);
        Ok(())
    }
    fn close(&mut self) -> Result<(), String> {
        if self.closed {
            return Ok(());
        }
        self.closed = true;
        if self.session.is_none() {
            return Ok(());
        }
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .map_err(|_| "BLK-MCP-TRANSPORT")?;
        runtime.block_on(async{tokio::select!{biased;_=tokio::time::sleep(Duration::from_secs(2))=>Err("BLK-MCP-TIMEOUT".into()),result=async{let response=self.request(reqwest::Method::DELETE).send().await.map_err(http_error)?;if response.status().is_success()||response.status().as_u16()==405{Ok(())}else if response.status().is_redirection(){Err("BLK-MCP-REDIRECT".into())}else{Err("BLK-MCP-HTTP".into())}}=>result}})
    }
}
impl Drop for HttpTransport {
    fn drop(&mut self) {
        let _ = self.close();
    }
}
#[cfg(test)]
#[path = "http_tests.rs"]
mod tests;
