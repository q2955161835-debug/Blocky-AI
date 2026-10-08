use super::*;
use serde_json::{Value, json};

fn request() -> Value {
    json!({"schemaVersion":"blocky.model-request/v2","requestId":"req1","projectId":"project1","resourceId":"model1",
      "messages":[{"role":"user","content":"Count the words"}],"tools":[{"name":"count","description":"Count words","parameters":{"type":"object","properties":{"text":{"type":"string"}},"required":["text"],"additionalProperties":false}}],
      "maxOutputTokens":512,"timeoutMs":30000})
}
#[test]
fn json_schema_properties_are_json_names_instead_of_block_identifiers() {
    let mut r = request();
    r["tools"][0]["parameters"] = json!({"type":"object","properties":{"acceptanceCriteria":{"type":"array","items":{"type":"string"}},"璇存槑":{"type":"string"}},"required":["acceptanceCriteria","璇存槑"],"additionalProperties":false});
    serde_json::from_value::<GatewayRequest>(r)
        .unwrap()
        .validate()
        .unwrap();
}
fn response() -> Value {
    json!({"id":"result1","model":"small:latest","choices":[{"message":{"role":"assistant","content":null,"tool_calls":[{"id":"call1","type":"function","function":{"name":"count","arguments":"{\"text\":\"two words\"}"}}]},"finish_reason":"tool_calls"}]})
}
#[test]
fn model_request_is_reference_only_and_tool_results_must_resolve_pending_calls() {
    let valid: GatewayRequest = serde_json::from_value(request()).unwrap();
    valid.validate().unwrap();
    let mut value = request();
    value["endpoint"] = json!("https://arbitrary.example.com");
    assert!(serde_json::from_value::<GatewayRequest>(value).is_err());
    let mut value = request();
    value["messages"].as_array_mut().unwrap().extend([
      json!({"role":"assistant","content":"","toolCalls":[{"id":"c1","name":"count","arguments":{"text":"a"}}]}),
      json!({"role":"tool","content":"1","toolCallId":"c1"})]);
    let valid: GatewayRequest = serde_json::from_value(value.clone()).unwrap();
    valid.validate().unwrap();
    value["messages"][2]["toolCallId"] = json!("forged");
    assert!(
        serde_json::from_value::<GatewayRequest>(value)
            .unwrap()
            .validate()
            .is_err()
    );
}
#[test]
fn unknown_usage_is_explicit_and_undeclared_or_malformed_tool_calls_fail() {
    let req: GatewayRequest = serde_json::from_value(request()).unwrap();
    let output = parse_response(&serde_json::to_vec(&response()).unwrap(), &req).unwrap();
    assert_eq!(output["usage"], Value::Null);
    assert_eq!(output["usageStatus"], "unavailable");
    assert_eq!(output["toolCalls"][0]["arguments"]["text"], "two words");
    for bad in [json!("undeclared"), json!("")] {
        let mut value = response();
        value["choices"][0]["message"]["tool_calls"][0]["function"]["name"] = bad;
        assert!(parse_response(&serde_json::to_vec(&value).unwrap(), &req).is_err());
    }
    let mut value = response();
    value["choices"][0]["finish_reason"] = json!("length");
    assert!(parse_response(&serde_json::to_vec(&value).unwrap(), &req).is_err());
    let mut value = response();
    value["usage"] = json!({"prompt_tokens":10,"completion_tokens":4,"total_tokens":15});
    assert!(parse_response(&serde_json::to_vec(&value).unwrap(), &req).is_err());
}
#[test]
fn failed_responses_return_only_fixed_diagnostic_codes() {
    let req: GatewayRequest = serde_json::from_value(request()).unwrap();
    assert_eq!(parse_response(b"{synthetic-private-token-and-url", &req).unwrap_err(), "BLK-MODEL-RESPONSE-JSON");
    let mut cases = Vec::new();
    let mut value = response();
    value["choices"][0]["finish_reason"] = json!("length");
    cases.push((value, "BLK-MODEL-TRUNCATED-LENGTH"));
    let mut value = response();
    value["choices"][0]["finish_reason"] = json!("synthetic-private-finish-value");
    cases.push((value, "BLK-MODEL-RESPONSE-SHAPE"));
    let mut value = response();
    value["choices"][0]["message"]["tool_calls"][0]["function"]["arguments"] = json!("{synthetic-private-arguments");
    cases.push((value, "BLK-MODEL-RESPONSE-TOOL-JSON"));
    let mut value = response();
    value["choices"][0]["message"]["tool_calls"][0]["function"]["name"] = json!("synthetic-private-tool");
    cases.push((value, "BLK-MODEL-RESPONSE-TOOLS"));
    let mut value = response();
    value["usage"] = json!({"prompt_tokens":10,"completion_tokens":4,"total_tokens":15});
    cases.push((value, "BLK-MODEL-RESPONSE-USAGE"));
    let mut value = response();
    value["usage"] = json!({"prompt_tokens":10,"completion_tokens":513,"total_tokens":523});
    cases.push((value, "BLK-MODEL-RESPONSE-USAGE"));
    for (value, expected) in cases {
        let error = parse_response(&serde_json::to_vec(&value).unwrap(), &req).unwrap_err();
        assert_eq!(error, expected);
        assert!(error.len() < 64 && error.bytes().all(|b| b.is_ascii_uppercase() || b.is_ascii_digit() || b == b'-'));
        assert!(!error.contains("synthetic-private"));
    }
    assert!(parse_response(&serde_json::to_vec(&response()).unwrap(), &req).is_ok());
}

/// Local HTTP only: exercise the same BuilderModel streaming bridge used by Coding.
fn synthetic_builder_stream(wire: String) -> Result<Value, String> {
    use std::io::{Read, Write};
    use crate::provider::builder_model::BuilderModel;
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let root = profile();
    install_resource(root.path(), &format!("http://{}/v1", listener.local_addr().unwrap()));
    let worker = std::thread::spawn(move || {
        let (mut socket, _) = listener.accept().unwrap();
        socket.set_read_timeout(Some(std::time::Duration::from_secs(5))).unwrap();
        let mut bytes = Vec::new();
        let mut buffer = [0u8; 8192];
        loop {
            let n = socket.read(&mut buffer).unwrap();
            assert!(n > 0);
            bytes.extend_from_slice(&buffer[..n]);
            if let Some(end) = bytes.windows(4).position(|w| w == b"\r\n\r\n") {
                let head = String::from_utf8_lossy(&bytes[..end]);
                let length = head.lines().find_map(|line| line.to_lowercase().strip_prefix("content-length: ").and_then(|s| s.parse::<usize>().ok())).unwrap();
                if bytes.len() >= end + 4 + length { break; }
            }
        }
        write!(socket, "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", wire.len(), wire).unwrap();
    });
    let model = BuilderModel::coding(root.path(), "diagnostic-fixture", "project1", "model1").unwrap();
    let result = model.generate_stream(root.path(), json!([{"role":"user","content":"public fixture"}]), 30000,
        &std::sync::atomic::AtomicBool::new(false), &mut None, &mut || Ok(()), &mut |_| Ok(()));
    worker.join().unwrap();
    result
}

#[test]
fn builder_stream_bridge_preserves_diagnostic_codes_without_raw_response_leaks() {
    fn wire(delta: Value, finish: &str, done: bool, usage: Option<Value>) -> String {
        let frame = json!({"id":"synthetic-private-id","model":"synthetic-private-model","choices":[{"index":0,"delta":delta,"finish_reason":finish}]});
        let mut wire = format!("data: {frame}\n\n");
        if let Some(usage) = usage { wire.push_str(&format!("data: {}\n\n", json!({"choices":[],"usage":usage}))); }
        if done { wire.push_str("data: [DONE]\n\n"); }
        wire
    }
    let text = json!({"content":"synthetic-private-body","reasoning_content":"synthetic-private-thought"});
    let malformed_tool = json!({"tool_calls":[{"index":0,"id":"call1","type":"function","function":{"name":"workspace_read","arguments":"{synthetic-private-arguments"}}]});
    for (wire, expected) in [
        (wire(text.clone(), "length", true, None), "BLK-MODEL-TRUNCATED-LENGTH"),
        (wire(text.clone(), "stop", false, None), "BLK-MODEL-TRUNCATED-SSE"),
        (wire(malformed_tool, "tool_calls", true, None), "BLK-MODEL-RESPONSE-TOOL-JSON"),
        (wire(text.clone(), "stop", true, Some(json!({"prompt_tokens":1,"completion_tokens":2,"total_tokens":99}))), "BLK-MODEL-RESPONSE-USAGE"),
        (wire(json!({"role":"synthetic-private-role"}), "stop", true, None), "BLK-MODEL-RESPONSE-SSE"),
        ("data: {synthetic-private-invalid-json\n\n".into(), "BLK-MODEL-RESPONSE-SSE"),
    ] {
        let error = synthetic_builder_stream(wire).unwrap_err();
        assert_eq!(error, expected);
        assert!(!error.contains("synthetic-private"));
    }
    assert!(synthetic_builder_stream(wire(text, "stop", true, None)).is_ok());
}
#[test]
fn endpoint_profiles_do_not_admit_private_remote_or_non_loopback_local_targets() {
    assert!(validate_endpoint("https://api.example.com/v1", false).is_ok());
    assert!(validate_endpoint("http://127.0.0.1:11434", true).is_ok());
    assert!(validate_endpoint("http://[::1]:11434", true).is_ok());
    for target in [
        "http://api.example.com",
        "https://127.0.0.1",
        "https://10.1.2.3",
        "https://user:pass@api.example.com",
        "https://api.example.com/?key=value",
        "https://api.example.com/v1#fragment",
        "https://foo.local",
        "https://api.example.com/../admin",
    ] {
        assert!(validate_endpoint(target, false).is_err(), "{target}");
    }
    for target in [
        "http://0.0.0.0:11434",
        "http://192.168.1.2",
        "http://example.com:11434",
        "http://localhost:11434",
        "http://127.0.0.2:11434",
    ] {
        assert!(validate_endpoint(target, true).is_err(), "{target}");
    }
}

fn profile() -> tempfile::TempDir {
    let root = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../try/agent-token-budgets/gateway-tests");
    std::fs::create_dir_all(&root).unwrap();
    tempfile::tempdir_in(root).unwrap()
}
fn install_resource(root: &std::path::Path, endpoint: &str) -> Value {
    let env = root.join("fixture.env");
    std::fs::write(&env, format!("MODEL_ENDPOINT={endpoint}\n")).unwrap();
    crate::secret_store::SecretStore::new(root.join("secrets"))
        .import_env("endpoint1", &env, "MODEL_ENDPOINT")
        .unwrap();
    let registry = json!({"schemaVersion":"blocky.user-resources/v1","resources":[{"schemaVersion":"blocky.resource/v1alpha1","resourceId":"model1","kind":"model","scope":"user","displayName":"Local test model","capabilityRequirements":[],"definition":{"provider":"ollama","modelId":"small:latest","protocol":"openai-chat","timeoutMs":30000,"capabilities":["text","tools"],"implementationRef":{"kind":"adapter","id":"ollama-v1"}},"secretBindings":[{"fieldId":"baseUrl","secretRef":"endpoint1"}]}]});
    crate::user_store::UserStore::new(root.join("user"))
        .write("resources", "app", registry.clone())
        .unwrap();
    registry
}
#[test]
fn approval_is_bound_to_secret_endpoint_and_resource_capabilities() {
    let root = profile();
    let mut registry = install_resource(root.path(), "http://127.0.0.1:11434/v1");
    let req: GatewayRequest = serde_json::from_value(request()).unwrap();
    let host = crate::provider::ProviderHost::default();
    let original = host.model_preflight(root.path(), &req).unwrap();
    assert!(!original.to_string().contains("127.0.0.1"));
    install_resource(root.path(), "http://127.0.0.1:11435/v1");
    let next = host.model_preflight(root.path(), &req).unwrap();
    assert_ne!(original["requestDigest"], next["requestDigest"]);
    assert_eq!(
        host.model_call(
            root.path().to_owned(),
            req.clone(),
            original["requestDigest"].as_str().unwrap()
        )
        .unwrap_err(),
        "BLK-PERM-001"
    );
    registry["resources"][0]["definition"]["capabilities"] = json!(["text"]);
    crate::user_store::UserStore::new(root.path().join("user"))
        .write("resources", "app", registry)
        .unwrap();
    assert_eq!(
        host.model_preflight(root.path(), &req).unwrap_err(),
        "BLK-MODEL-CAPABILITY"
    );
}
#[test]
fn local_request_uses_bound_model_and_tool_payload_without_fabricating_usage() {
    use std::io::{Read, Write};
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = listener.local_addr().unwrap();
    let root = profile();
    install_resource(root.path(), &format!("http://{addr}/v1"));
    let worker = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        stream
            .set_read_timeout(Some(std::time::Duration::from_secs(3)))
            .unwrap();
        let mut bytes = vec![];
        let mut buf = [0u8; 8192];
        loop {
            let n = stream.read(&mut buf).unwrap();
            if n == 0 {
                break;
            }
            bytes.extend_from_slice(&buf[..n]);
            if let Some(index) = bytes.windows(4).position(|w| w == b"\r\n\r\n") {
                let head = String::from_utf8_lossy(&bytes[..index]);
                let size = head
                    .lines()
                    .find_map(|l| {
                        l.to_lowercase()
                            .strip_prefix("content-length: ")
                            .and_then(|n| n.parse::<usize>().ok())
                    })
                    .unwrap();
                if bytes.len() >= index + 4 + size {
                    break;
                }
            }
        }
        let body = response().to_string();
        write!(
            stream,
            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        )
        .unwrap();
        String::from_utf8(bytes).unwrap()
    });
    let req: GatewayRequest = serde_json::from_value(request()).unwrap();
    let host = crate::provider::ProviderHost::default();
    let p = host.model_preflight(root.path(), &req).unwrap();
    let value = host
        .model_call(
            root.path().to_owned(),
            req,
            p["requestDigest"].as_str().unwrap(),
        )
        .unwrap();
    assert_eq!(value["transport"], "local");
    assert_eq!(value["usageStatus"], "unavailable");
    assert_eq!(value["toolCalls"][0]["name"], "count");
    let wire = worker.join().unwrap();
    assert!(wire.starts_with("POST /v1/chat/completions "));
    assert!(!wire.to_lowercase().contains("authorization:"));
    let body: Value = serde_json::from_str(wire.split_once("\r\n\r\n").unwrap().1).unwrap();
    assert_eq!(body["model"], "small:latest");
    assert_eq!(body["tools"][0]["function"]["name"], "count");
}

#[test]
fn uncapped_request_omits_wire_limit_and_accepts_long_response_with_real_usage() {
    let mut value = request();
    value.as_object_mut().unwrap().remove("maxOutputTokens");
    let req: GatewayRequest = serde_json::from_value(value).unwrap();
    req.validate().unwrap();
    assert!(req.body("fixture", "ollama").get("max_tokens").is_none());
    let text = "中".repeat(100_000);
    let wire = json!({"id":"long-response","model":"fixture","choices":[{"message":{"role":"assistant","content":text},"finish_reason":"stop"}],"usage":{"prompt_tokens":50,"completion_tokens":100_000,"total_tokens":100_050}});
    let parsed = parse_response(&serde_json::to_vec(&wire).unwrap(), &req).unwrap();
    assert_eq!(parsed["text"], wire["choices"][0]["message"]["content"]);
    assert_eq!(parsed["usage"]["outputTokens"], 100_000);
    let mut invalid = wire;
    invalid["usage"] = json!({"prompt_tokens":9_007_199_254_740_991u64,"completion_tokens":1,"total_tokens":9_007_199_254_740_992u64});
    assert!(parse_response(&serde_json::to_vec(&invalid).unwrap(), &req).is_err());
}
#[test]
fn configured_limit_cannot_be_bypassed_with_an_uncapped_request() {
    let root = profile();
    let mut registry = install_resource(root.path(), "http://127.0.0.1:11434/v1");
    registry["resources"][0]["definition"]["parameters"] = json!({"maxOutputTokens":100_000});
    crate::user_store::UserStore::new(root.path().join("user")).write("resources", "app", registry).unwrap();
    let mut value = request();
    value.as_object_mut().unwrap().remove("maxOutputTokens");
    let uncapped: GatewayRequest = serde_json::from_value(value.clone()).unwrap();
    assert!(binding::Binding::load(root.path(), &uncapped).is_err());
    value["maxOutputTokens"] = json!(100_000);
    let configured: GatewayRequest = serde_json::from_value(value.clone()).unwrap();
    let bound = binding::Binding::load(root.path(), &configured).unwrap();
    assert_eq!(bound.body(root.path(), &configured).unwrap()["max_tokens"], 100_000);
    value["maxOutputTokens"] = json!(100_001);
    assert!(binding::Binding::load(root.path(), &serde_json::from_value(value).unwrap()).is_err());
}

#[test]
fn uncapped_http_exchange_preserves_a_large_tool_argument_and_text() {
    use std::io::{Read, Write};
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = listener.local_addr().unwrap();
    let root = profile();
    install_resource(root.path(), &format!("http://{addr}/v1"));
    let worker = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        stream
            .set_read_timeout(Some(std::time::Duration::from_secs(3)))
            .unwrap();
        let mut bytes = vec![];
        let mut buf = [0u8; 8192];
        loop {
            let n = stream.read(&mut buf).unwrap();
            if n == 0 {
                break;
            }
            bytes.extend_from_slice(&buf[..n]);
            if let Some(index) = bytes.windows(4).position(|w| w == b"\r\n\r\n") {
                let head = String::from_utf8_lossy(&bytes[..index]);
                let size = head
                    .lines()
                    .find_map(|l| {
                        l.to_lowercase()
                            .strip_prefix("content-length: ")
                            .and_then(|n| n.parse::<usize>().ok())
                    })
                    .unwrap();
                if bytes.len() >= index + 4 + size {
                    break;
                }
            }
        }
        let body = json!({"id":"large-http","model":"small:latest","choices":[{"message":{"role":"assistant","content":"中".repeat(100_000),"tool_calls":[{"id":"long-call","type":"function","function":{"name":"count","arguments":json!({"text":"中".repeat(100_000)}).to_string()}}]},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":17,"completion_tokens":100_000,"total_tokens":100_017}}).to_string();
        write!(
            stream,
            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        )
        .unwrap();
        String::from_utf8(bytes).unwrap()
    });
    let mut input = request();
    input.as_object_mut().unwrap().remove("maxOutputTokens");
    let req: GatewayRequest = serde_json::from_value(input).unwrap();
    let host = crate::provider::ProviderHost::default();
    let p = host.model_preflight(root.path(), &req).unwrap();
    let value = host
        .model_call(
            root.path().to_owned(),
            req,
            p["requestDigest"].as_str().unwrap(),
        )
        .unwrap();
    assert_eq!(value["transport"], "local");
    assert_eq!(value["usageStatus"], "reported");
    assert_eq!(value["text"], "中".repeat(100_000));
    assert_eq!(value["toolCalls"][0]["arguments"]["text"], "中".repeat(100_000));
    assert_eq!(value["toolCalls"][0]["name"], "count");
    let wire = worker.join().unwrap();
    assert!(wire.starts_with("POST /v1/chat/completions "));
    assert!(!wire.to_lowercase().contains("authorization:"));
    let body: Value = serde_json::from_str(wire.split_once("\r\n\r\n").unwrap().1).unwrap();
    assert!(body.get("max_tokens").is_none());
    assert_eq!(body["model"], "small:latest");
    assert_eq!(body["tools"][0]["function"]["name"], "count");
}

#[test]
fn coding_model_reads_the_exact_optional_output_and_timeout_configuration() {
    use crate::provider::builder_model::BuilderModel;
    let root = profile();
    let mut registry = install_resource(root.path(), "http://127.0.0.1:11434/v1");
    let model = BuilderModel::coding(root.path(), "coding-fixture", "project1", "model1").unwrap();
    assert_eq!(model.max_output_tokens(), None);
    registry["resources"][0]["definition"]["parameters"] = json!({"maxOutputTokens":10_000_000});
    registry["resources"][0]["definition"]["timeoutMs"] = json!(3_600_000);
    crate::user_store::UserStore::new(root.path().join("user")).write("resources", "app", registry).unwrap();
    let configured = BuilderModel::coding(root.path(), "coding-configured", "project1", "model1").unwrap();
    assert_eq!(configured.max_output_tokens(), Some(10_000_000));
    if let BuilderModel::Gateway { request, .. } = configured {
        assert_eq!(request.timeout_ms, 3_600_000);
        assert_eq!(request.body("fixture", "ollama")["max_tokens"], 10_000_000);
    } else { panic!("expected reference gateway"); }
}

#[test]
fn request_reasoning_is_translated_and_real_reasoning_is_preserved() {
    let mut value=request();value["reasoningEffort"]=json!("max");
    value["messages"].as_array_mut().unwrap().push(json!({"role":"assistant","content":"reply","reasoningContent":"provider reasoning"}));
    let r:GatewayRequest=serde_json::from_value(value.clone()).unwrap();r.validate().unwrap();
    let body=r.body("deepseek-v4-pro","xirang");
    assert_eq!(body["thinking"]["type"],"enabled");assert_eq!(body["reasoning_effort"],"max");
    assert_eq!(body["messages"][1]["reasoning_content"],"provider reasoning");
    let mut wire=response();wire["choices"][0]["message"]["reasoning_content"]=json!("returned reasoning");
    assert_eq!(parse_response(&serde_json::to_vec(&wire).unwrap(),&r).unwrap()["reasoningContent"],"returned reasoning");
    value["reasoningEffort"]=json!("unrecognized");assert!(serde_json::from_value::<GatewayRequest>(value).unwrap().validate().is_err());
}

// Explicit opt-in diagnostics. No raw provider fields are printed or persisted.
fn response_diagnostics(bytes: &[u8], request: &GatewayRequest) -> Value {
    fn kind(v:&Value)->&'static str {match v {Value::Null=>"null",Value::Bool(_)=>"boolean",Value::Number(_)=>"number",Value::String(_)=>"string",Value::Array(_)=>"array",Value::Object(_)=>"object"}}
    let Ok(value)=crate::strict_json::parse(bytes) else {return json!({"bytes":bytes.len(),"strictJson":false});};
    let choice=&value["choices"][0];let m=&choice["message"];let finish=choice["finish_reason"].as_str().filter(|f|["stop","tool_calls","length","content_filter","insufficient_system_resource"].contains(f)).unwrap_or("unknown");
    let input=value["usage"]["prompt_tokens"].as_u64();let output=value["usage"]["completion_tokens"].as_u64();let total=value["usage"]["total_tokens"].as_u64();
    let calls=m["tool_calls"].as_array().map(|calls|calls.iter().map(|call| {
        let args=call["function"]["arguments"].as_str().and_then(|s|crate::strict_json::parse(s.as_bytes()).ok());
        json!({"declaredName":call["function"]["name"].as_str().is_some_and(|name|request.tools.iter().any(|t|t.name==name)),"typeFunction":call["type"]=="function","idValid":call["id"].as_str().is_some_and(|s|!s.is_empty()&&s.len()<=128&&s.bytes().all(|b|b.is_ascii_alphanumeric()||b"_-".contains(&b))),"argumentsString":call["function"]["arguments"].is_string(),"argumentsObject":args.is_some_and(|v|v.is_object())})
    }).collect::<Vec<_>>());
    json!({"bytes":bytes.len(),"strictJson":true,"choiceCount":value["choices"].as_array().map(Vec::len),"role":if m["role"]=="assistant" {"assistant"} else {"unknown"},"finish":finish,"contentType":kind(&m["content"]),"contentBytes":m["content"].as_str().map(str::len),"toolCallsPresent":m.get("tool_calls").is_some(),"toolCallsType":kind(&m["tool_calls"]),"toolCallCount":m["tool_calls"].as_array().map(Vec::len),"toolShapes":calls,"usageType":kind(&value["usage"]),"usage":{"input":input,"output":output,"total":total,"sumEqual":input.zip(output).zip(total).is_some_and(|((i,o),t)|i.checked_add(o)==Some(t))},"reasoningType":kind(&m["reasoning_content"]),"reasoningBytes":m["reasoning_content"].as_str().map(str::len),"modelValid":value["model"].as_str().is_some_and(|s|!s.is_empty()&&s.len()<=128&&!s.chars().any(char::is_control)),"idValid":value["id"].as_str().is_some_and(|s|!s.is_empty()&&s.len()<=256&&!s.chars().any(char::is_control))})
}
#[test]
#[ignore = "Calls the authorized real API with a public synthetic task; run explicitly only"]
fn public_synthetic_max_tool_round_trip_diagnostics() {
    let root=std::path::Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap().parent().unwrap().join("try/assistant-streaming-2026-10-09/api-profile");
    let tools=json!([{"name":"public_fixture","description":"Returns a fixed public marker. Call this once before answering.","parameters":{"type":"object","properties":{},"additionalProperties":false}}]);
    let mut value=json!({"schemaVersion":"blocky.model-request/v2","requestId":format!("max-diagnostic-{}-first",crate::builder::evidence::now()),"projectId":"reasoning-probe-project","resourceId":"reasoning-probe-model","messages":[{"role":"user","content":"Call public_fixture exactly once with empty arguments. After the tool returns, reply exactly OK. This is a public synthetic capability test."}],"tools":tools,"toolChoice":"auto","timeoutMs":180000,"reasoningEffort":"max"});
    let cancel=std::sync::atomic::AtomicBool::new(false);
    let call=|value:Value,turn:u8| {
        let request:GatewayRequest=serde_json::from_value(value).unwrap();let bound=binding::Binding::load(&root,&request).unwrap();
        let generated=execute(&root,&request,&bound,&cancel,&mut ||Ok(()),&mut |bytes|println!("MAX_API_DIAGNOSTICS {}",json!({"turn":turn,"diagnostics":response_diagnostics(bytes,&request)})));
        println!("MAX_API_PARSE {}",json!({"turn":turn,"ok":generated.is_ok(),"code":generated.as_ref().err()}));
        generated
    };
    let first=call(value.clone(),1).expect("First max tool turn must pass");
    assert_eq!(first["toolCalls"].as_array().map(Vec::len),Some(1));assert_eq!(first["toolCalls"][0]["name"],"public_fixture");
    let assistant=json!({"role":"assistant","content":first["text"],"toolCalls":first["toolCalls"],"reasoningContent":first["reasoningContent"]});
    value["messages"].as_array_mut().unwrap().push(assistant);
    value["messages"].as_array_mut().unwrap().push(json!({"role":"tool","content":"public synthetic fixture","toolCallId":first["toolCalls"][0]["id"]}));
    value["requestId"]=json!(format!("max-diagnostic-{}-second",crate::builder::evidence::now()));value["toolChoice"]=json!("none");
    let second=call(value,2).expect("Second max turn must parse; diagnostic output contains only safe schema metadata");
    assert!(second["text"].as_str().map(str::trim)==Some("OK"),"Synthetic answer marker mismatch");
}
