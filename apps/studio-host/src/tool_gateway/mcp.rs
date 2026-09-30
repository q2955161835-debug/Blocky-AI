use super::{binding::Binding, ToolRequest};
use crate::mcp_client::{http::HttpTransport, Client, Transport};
use serde_json::{json, Value};
use std::path::Path;
fn uri_ref(uri: &str) -> Result<String, String> {
    Ok(format!("uri-{}", crate::agent_data::digest(&uri)?))
}
fn operation<T: Transport>(
    transport: T,
    bound: &Binding,
    r: &ToolRequest,
    cancel: &dyn Fn() -> Result<(), String>,
) -> Result<Value, String> {
    let mut client = Client::connect(transport, cancel)?;
    let result = (|| match r.action.as_str() {
        "discover" => {
            let tools = client.tools_if_available(cancel)?;
            let resources=client.resources_if_available(cancel)?.iter().map(|v|Ok(json!({"uriRef":uri_ref(v["uri"].as_str().ok_or("BLK-MCP-PROTOCOL")?)?,"name":v["name"],"mimeType":v["mimeType"]}))).collect::<Result<Vec<_>,String>>()?;
            Ok(json!({"tools":tools,"resources":resources}))
        }
        "read-resource" => {
            let resources = client.resources(cancel)?;
            let uri = resources
                .iter()
                .find_map(|v| {
                    let uri = v["uri"].as_str()?;
                    (uri_ref(uri).ok()?.as_str() == r.input["uriRef"].as_str()?).then_some(uri)
                })
                .ok_or("BLK-MCP-RESOURCE")?;
            let response = client.read_resource(uri, cancel)?;
            let contents = response["contents"]
                .as_array()
                .ok_or("BLK-MCP-PROTOCOL")?
                .iter()
                .map(|v| json!({"text":v["text"],"mimeType":v["mimeType"]}))
                .collect::<Vec<_>>();
            Ok(json!({"uriRef":r.input["uriRef"],"contents":contents}))
        }
        "call" => {
            let name = bound.resource["definition"]["toolName"]
                .as_str()
                .ok_or("BLK-TOOL-CONFIG")?;
            let tools = client.tools(cancel)?;
            let tool = tools
                .iter()
                .find(|tool| tool["name"] == name)
                .ok_or("BLK-MCP-TOOL")?;
            if tool["inputSchema"] != *bound.input_schema.as_ref().ok_or("BLK-TOOL-SCHEMA")? {
                return Err("BLK-TOOL-SCHEMA-CHANGED".into());
            }
            if tool
                .get("outputSchema")
                .is_some_and(|schema| Some(schema) != bound.output_schema.as_ref())
            {
                return Err("BLK-TOOL-SCHEMA-CHANGED".into());
            }
            let response = client.call_tool(name, r.input.clone(), cancel)?;
            if response["isError"] == true {
                return Err("BLK-MCP-TOOL-ERROR".into());
            }
            if let Some(value) = response.get("structuredContent") {
                return Ok(value.clone());
            }
            let content = response["content"].as_array().ok_or("BLK-MCP-PROTOCOL")?;
            if content.iter().any(|item| item["type"] != "text") {
                return Err("BLK-MCP-CONTENT".into());
            }
            Ok(content
                .iter()
                .map(|item| item["text"].as_str().unwrap_or(""))
                .collect::<Vec<_>>()
                .join("\n")
                .into())
        }
        _ => Err("BLK-TOOL-INVALID".into()),
    })();
    client.close()?;
    result
}
pub(crate) fn execute(
    root: &Path,
    bound: &Binding,
    r: &ToolRequest,
    cancel: &dyn Fn() -> Result<(), String>,
) -> Result<Value, String> {
    if let Some(launch) = &bound.launch {
        #[cfg(windows)]
        {
            let transport = launch.start(
                root,
                bound.bundle_digest.as_deref().ok_or("BLK-TOOL-CONFIG")?,
                r.timeout_ms,
                cancel,
            )?;
            return operation(transport, bound, r, cancel);
        }
        #[cfg(not(windows))]
        {
            let _ = (launch, root);
            return Err("BLK-TOOL-PLATFORM".into());
        }
    }
    let transport = HttpTransport::new(
        bound.endpoint.clone().ok_or("BLK-TOOL-CONFIG")?,
        bound.headers.clone(),
        bound.mode,
        r.timeout_ms,
    )?;
    operation(transport, bound, r, cancel)
}
