//! Bounded MCP client semantics. Transports never acquire Host capabilities.
pub mod http;
#[cfg(windows)]
pub(crate) mod stdio;
mod validation;
use serde_json::{json, Value};
use std::collections::BTreeSet;
pub(crate) fn validate_json(value: &Value, bytes: usize) -> Result<(), String> {
    validation::bounded(value, bytes)
}
pub trait Transport {
    fn exchange(
        &mut self,
        message: &Value,
        cancel: &dyn Fn() -> Result<(), String>,
    ) -> Result<Option<Value>, String>;
    fn negotiated(&mut self, version: &str) -> Result<(), String>;
    fn close(&mut self) -> Result<(), String>;
}
pub struct Client<T: Transport> {
    transport: T,
    next_id: u64,
    tools: bool,
    resources: bool,
    closed: bool,
}
impl<T: Transport> Client<T> {
    pub(crate) fn tools_if_available(
        &mut self,
        cancel: &dyn Fn() -> Result<(), String>,
    ) -> Result<Vec<Value>, String> {
        if self.tools {
            self.tools(cancel)
        } else {
            Ok(vec![])
        }
    }
    pub(crate) fn resources_if_available(
        &mut self,
        cancel: &dyn Fn() -> Result<(), String>,
    ) -> Result<Vec<Value>, String> {
        if self.resources {
            self.resources(cancel)
        } else {
            Ok(vec![])
        }
    }
    pub fn connect(transport: T, cancel: &dyn Fn() -> Result<(), String>) -> Result<Self, String> {
        let mut client = Self {
            transport,
            next_id: 1,
            tools: false,
            resources: false,
            closed: false,
        };
        let init = client.rpc("initialize", json!({"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"Blocky","version":"0.8.0"}}), cancel)?;
        let version = init["protocolVersion"].as_str().ok_or("BLK-MCP-VERSION")?;
        if !["2025-11-25", "2025-06-18", "2025-03-26"].contains(&version) {
            return Err("BLK-MCP-VERSION".into());
        }
        let capabilities = init["capabilities"].as_object().ok_or("BLK-MCP-PROTOCOL")?;
        validation::text(&init["serverInfo"]["name"], 256)?;
        validation::text(&init["serverInfo"]["version"], 128)?;
        client.tools = capabilities.get("tools").is_some_and(Value::is_object);
        client.resources = capabilities.get("resources").is_some_and(Value::is_object);
        client.transport.negotiated(version)?;
        if client
            .transport
            .exchange(
                &json!({"jsonrpc":"2.0","method":"notifications/initialized"}),
                cancel,
            )?
            .is_some()
        {
            return Err("BLK-MCP-PROTOCOL".into());
        }
        Ok(client)
    }
    fn rpc(
        &mut self,
        method: &str,
        params: Value,
        cancel: &dyn Fn() -> Result<(), String>,
    ) -> Result<Value, String> {
        cancel()?;
        if self.closed {
            return Err("BLK-MCP-CLOSED".into());
        }
        let id = self.next_id;
        self.next_id = self.next_id.checked_add(1).ok_or("BLK-MCP-LIMIT")?;
        let reply = self
            .transport
            .exchange(
                &json!({"jsonrpc":"2.0","id":id,"method":method,"params":params}),
                cancel,
            )?
            .ok_or("BLK-MCP-PROTOCOL")?;
        cancel()?;
        validation::bounded(&reply, 262144)?;
        if !reply.is_object()
            || reply["jsonrpc"] != "2.0"
            || reply["id"] != id
            || reply.get("method").is_some()
            || (reply.get("result").is_some() == reply.get("error").is_some())
        {
            return Err("BLK-MCP-PROTOCOL".into());
        }
        if reply.get("error").is_some() {
            return Err("BLK-MCP-RPC".into());
        }
        let result = reply.get("result").ok_or("BLK-MCP-PROTOCOL")?;
        if !result.is_object() {
            return Err("BLK-MCP-PROTOCOL".into());
        }
        Ok(result.clone())
    }
    fn list(
        &mut self,
        method: &str,
        field: &str,
        key: &str,
        cancel: &dyn Fn() -> Result<(), String>,
    ) -> Result<Vec<Value>, String> {
        let mut cursor = None;
        let mut cursors = BTreeSet::new();
        let mut keys = BTreeSet::new();
        let mut items = Vec::new();
        for _ in 0..16 {
            let params = cursor
                .map(|v| json!({"cursor":v}))
                .unwrap_or_else(|| json!({}));
            let result = self.rpc(method, params, cancel)?;
            let page = result[field].as_array().ok_or("BLK-MCP-PROTOCOL")?;
            if items.len() + page.len() > 128 {
                return Err("BLK-MCP-LIMIT".into());
            }
            for item in page {
                let id = validation::text(&item[key], if key == "uri" { 4096 } else { 128 })?;
                if !keys.insert(id.to_owned()) {
                    return Err("BLK-MCP-DUPLICATE".into());
                }
                if field == "tools" {
                    validation::schema(&item["inputSchema"])?;
                    if let Some(output) = item.get("outputSchema") {
                        validation::schema(output)?;
                    }
                } else {
                    validation::text(&item["name"], 256)?;
                }
                if let Some(description) = item.get("description") {
                    validation::optional_text(description, 4096)?;
                }
                items.push(item.clone());
            }
            validation::bounded(&json!(items), 262144)?;
            match result.get("nextCursor") {
                None => return Ok(items),
                Some(value) => {
                    let next = validation::text(value, 4096)?.to_owned();
                    if !cursors.insert(next.clone()) {
                        return Err("BLK-MCP-PAGINATION".into());
                    }
                    cursor = Some(next);
                }
            }
        }
        Err("BLK-MCP-LIMIT".into())
    }
    pub fn tools(&mut self, cancel: &dyn Fn() -> Result<(), String>) -> Result<Vec<Value>, String> {
        if !self.tools {
            return Err("BLK-MCP-CAPABILITY".into());
        }
        self.list("tools/list", "tools", "name", cancel)
    }
    pub fn resources(
        &mut self,
        cancel: &dyn Fn() -> Result<(), String>,
    ) -> Result<Vec<Value>, String> {
        if !self.resources {
            return Err("BLK-MCP-CAPABILITY".into());
        }
        self.list("resources/list", "resources", "uri", cancel)
    }
    pub fn call_tool(
        &mut self,
        name: &str,
        arguments: Value,
        cancel: &dyn Fn() -> Result<(), String>,
    ) -> Result<Value, String> {
        if !self.tools {
            return Err("BLK-MCP-CAPABILITY".into());
        }
        validation::text(&json!(name), 128)?;
        if !arguments.is_object() {
            return Err("BLK-MCP-INPUT".into());
        }
        validation::bounded(&arguments, 32768)?;
        let result = self.rpc(
            "tools/call",
            json!({"name":name,"arguments":arguments}),
            cancel,
        )?;
        if result.get("isError").is_some_and(|v| !v.is_boolean()) {
            return Err("BLK-MCP-PROTOCOL".into());
        }
        let content = result["content"].as_array().ok_or("BLK-MCP-PROTOCOL")?;
        if content.len() > 64 {
            return Err("BLK-MCP-LIMIT".into());
        }
        for item in content {
            validation::content(item)?;
        }
        if result
            .get("structuredContent")
            .is_some_and(|v| !v.is_object())
        {
            return Err("BLK-MCP-PROTOCOL".into());
        }
        Ok(result)
    }
    pub fn read_resource(
        &mut self,
        uri: &str,
        cancel: &dyn Fn() -> Result<(), String>,
    ) -> Result<Value, String> {
        if !self.resources {
            return Err("BLK-MCP-CAPABILITY".into());
        }
        validation::text(&json!(uri), 4096)?;
        let result = self.rpc("resources/read", json!({"uri":uri}), cancel)?;
        let content = result["contents"].as_array().ok_or("BLK-MCP-PROTOCOL")?;
        if content.len() > 64 {
            return Err("BLK-MCP-LIMIT".into());
        }
        for item in content {
            validation::resource(item)?;
        }
        Ok(result)
    }
    pub fn close(&mut self) -> Result<(), String> {
        if self.closed {
            return Ok(());
        }
        self.closed = true;
        self.transport.close()
    }
}
impl<T: Transport> Drop for Client<T> {
    fn drop(&mut self) {
        let _ = self.close();
    }
}
