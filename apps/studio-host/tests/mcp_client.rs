use blocky_studio::mcp_client::{Client, Transport};
use serde_json::{json, Value};
use std::sync::{Arc, Mutex};
#[derive(Default)]
struct State {
    sent: Vec<Value>,
    closed: usize,
    version: String,
}
struct Wire {
    state: Arc<Mutex<State>>,
    replies: std::collections::VecDeque<Value>,
}
impl Transport for Wire {
    fn exchange(
        &mut self,
        message: &Value,
        cancel: &dyn Fn() -> Result<(), String>,
    ) -> Result<Option<Value>, String> {
        cancel()?;
        self.state.lock().unwrap().sent.push(message.clone());
        if message.get("id").is_none() {
            return Ok(None);
        }
        let result = self.replies.pop_front().ok_or("BLK-MCP-EMPTY")?;
        if result.get("jsonrpc").is_some() {
            return Ok(Some(result));
        }
        Ok(Some(
            json!({"jsonrpc":"2.0","id":message["id"],"result":result}),
        ))
    }
    fn negotiated(&mut self, version: &str) -> Result<(), String> {
        self.state.lock().unwrap().version = version.into();
        Ok(())
    }
    fn close(&mut self) -> Result<(), String> {
        self.state.lock().unwrap().closed += 1;
        Ok(())
    }
}
fn make_wire(replies: Vec<Value>) -> (Wire, Arc<Mutex<State>>) {
    let state = Arc::new(Mutex::new(State::default()));
    (
        Wire {
            state: state.clone(),
            replies: replies.into(),
        },
        state,
    )
}
fn init() -> Value {
    json!({"protocolVersion":"2025-11-25","capabilities":{"tools":{},"resources":{}},"serverInfo":{"name":"public-fixture","version":"1.0"}})
}
fn ok() -> Result<(), String> {
    Ok(())
}
#[test]
fn negotiates_then_discovers_and_calls_typed_tools_and_resources() {
    let (wire, state) = make_wire(vec![
        init(),
        json!({"tools":[{"name":"count","description":"Count words","inputSchema":{"type":"object"}}],"nextCursor":"page-2"}),
        json!({"tools":[{"name":"sum","inputSchema":{"type":"object"}}]}),
        json!({"content":[{"type":"text","text":"2"}],"structuredContent":{"words":2},"isError":false}),
        json!({"resources":[{"uri":"fixture://facts/one","name":"Public facts"}]}),
        json!({"contents":[{"uri":"fixture://facts/one","mimeType":"text/plain","text":"Public facts"}]}),
    ]);
    let mut client = Client::connect(wire, &ok).unwrap();
    assert_eq!(client.tools(&ok).unwrap().len(), 2);
    assert_eq!(
        client
            .call_tool("count", json!({"text":"Hello world"}), &ok)
            .unwrap()["structuredContent"]["words"],
        2
    );
    assert_eq!(client.resources(&ok).unwrap().len(), 1);
    assert_eq!(
        client.read_resource("fixture://facts/one", &ok).unwrap()["contents"][0]["text"],
        "Public facts"
    );
    client.close().unwrap();
    drop(client);
    let state = state.lock().unwrap();
    assert_eq!(state.version, "2025-11-25");
    assert_eq!(state.closed, 1);
    assert_eq!(state.sent[0]["method"], "initialize");
    assert_eq!(state.sent[0]["params"]["capabilities"], json!({}));
    assert_eq!(state.sent[1]["method"], "notifications/initialized");
    assert_eq!(state.sent[3]["params"]["cursor"], "page-2");
}
#[test]
fn failed_negotiation_closes_transport_and_does_not_claim_capabilities() {
    let mut invalid = init();
    invalid["protocolVersion"] = json!("unknown-future");
    let (wire, state) = make_wire(vec![invalid]);
    assert!(Client::connect(wire, &ok).is_err());
    assert_eq!(state.lock().unwrap().closed, 1);
}
#[test]
fn rejects_duplicate_tools_and_pagination_loops() {
    for reply in [
        json!({"tools":[{"name":"same","inputSchema":{"type":"object"}},{"name":"same","inputSchema":{"type":"object"}}]}),
        json!({"tools":[],"nextCursor":"again"}),
    ] {
        let (wire, _) = make_wire(vec![init(), reply.clone(), reply]);
        let mut client = Client::connect(wire, &ok).unwrap();
        assert!(client.tools(&ok).is_err());
    }
}
#[test]
fn mismatched_rpc_ids_and_remote_error_details_are_never_results() {
    for response in [
        json!({"jsonrpc":"2.0","id":999,"result":{}}),
        json!({"jsonrpc":"2.0","id":2,"result":{},"error":{"code":-1,"message":"PRIVATE_DETAIL"}}),
        json!({"jsonrpc":"2.0","id":2,"error":{"code":-32000,"message":"PRIVATE_DETAIL"}}),
    ] {
        let (wire, _) = make_wire(vec![init(), response]);
        let mut client = Client::connect(wire, &ok).unwrap();
        let code = client.tools(&ok).unwrap_err();
        assert!(code.starts_with("BLK-MCP-"));
        assert!(!code.contains("PRIVATE_DETAIL"));
    }
}
#[test]
fn cancellation_prevents_transmission_and_server_without_tools_cannot_be_called() {
    let (wire, state) = make_wire(vec![init()]);
    let mut client = Client::connect(wire, &ok).unwrap();
    let before = state.lock().unwrap().sent.len();
    assert_eq!(
        client
            .tools(&|| Err("BLK-MCP-CANCELLED".into()))
            .unwrap_err(),
        "BLK-MCP-CANCELLED"
    );
    assert_eq!(state.lock().unwrap().sent.len(), before);
    let mut initialize = init();
    initialize["capabilities"] = json!({});
    let (wire, state) = make_wire(vec![initialize]);
    let mut client = Client::connect(wire, &ok).unwrap();
    assert!(client.call_tool("count", json!({}), &ok).is_err());
    assert_eq!(state.lock().unwrap().sent.len(), 2);
}
#[test]
fn tool_execution_failure_is_distinct_from_rpc_failure_and_media_is_explicitly_unsupported() {
    let (wire, _) = make_wire(vec![
        init(),
        json!({"content":[{"type":"text","text":"Could not process input"}],"isError":true}),
        json!({"content":[{"type":"image","mimeType":"image/png","data":"AA=="}]}),
    ]);
    let mut client = Client::connect(wire, &ok).unwrap();
    assert_eq!(
        client.call_tool("count", json!({}), &ok).unwrap()["isError"],
        true
    );
    assert_eq!(
        client.call_tool("count", json!({}), &ok).unwrap_err(),
        "BLK-MCP-CONTENT"
    );
}
