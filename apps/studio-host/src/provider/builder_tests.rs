use super::builder::*;
use serde_json::{json, Value};
fn reply() -> Value {
    json!({"id":"response-1","model":"returned-model","choices":[{"message":{"role":"assistant","content":null,"tool_calls":[{"id":"call-1","type":"function","function":{"name":"inspect","arguments":"{}"}}]},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":3,"completion_tokens":2,"total_tokens":5}})
}
#[test]
fn builder_accepts_real_tool_calls_and_rejects_unknown_or_malformed_calls() {
    let valid = reply();
    assert_eq!(
        parse_response(valid.to_string().as_bytes(), 1024).unwrap()["content"][0]["name"],
        "inspect"
    );
    for (field, value) in [
        ("name", json!("bash")),
        ("arguments", json!("{broken")),
        ("arguments", json!("[]")),
    ] {
        let mut bad = reply();
        bad["choices"][0]["message"]["tool_calls"][0]["function"][field] = value;
        assert!(parse_response(bad.to_string().as_bytes(), 1024).is_err());
    }
    let mut duplicate = reply();
    let call = duplicate["choices"][0]["message"]["tool_calls"][0].clone();
    duplicate["choices"][0]["message"]["tool_calls"]
        .as_array_mut()
        .unwrap()
        .push(call);
    assert!(parse_response(duplicate.to_string().as_bytes(), 1024).is_err());
}
#[test]
fn builder_accepts_provider_tool_index_but_rejects_invalid_indices() {
    let mut indexed = reply();
    indexed["choices"][0]["message"]["tool_calls"][0]["index"] = json!(0);
    assert!(parse_response(indexed.to_string().as_bytes(), 1024).is_ok());
    for invalid in [json!(-1), json!(8), json!("0")] {
        indexed["choices"][0]["message"]["tool_calls"][0]["index"] = invalid;
        assert!(parse_response(indexed.to_string().as_bytes(), 1024).is_err());
    }
}
#[test]
fn builder_wire_validates_tool_result_order_and_fixed_tools() {
    assert!(validate_messages(
        &json!([{"role":"system","content":"Blocky"},{"role":"user","content":"Build"}])
    )
    .is_ok());
    assert!(
        validate_messages(&json!([{"role":"tool","tool_call_id":"unknown","content":"ok"}]))
            .is_err()
    );
    assert!(validate_messages(
        &json!([{"role":"user","content":"ok","endpoint":"https://example.com"}])
    )
    .is_err());
    assert_eq!(tool_definitions().unwrap().as_array().unwrap().len(), 4);
}
