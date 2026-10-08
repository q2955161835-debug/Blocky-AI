use serde_json::{Value, json};
use std::collections::BTreeMap;
const UTF8: &str = "BLK-MODEL-RESPONSE-SSE-UTF8";
const JSON: &str = "BLK-MODEL-RESPONSE-SSE-JSON";
const ORDER: &str = "BLK-MODEL-RESPONSE-SSE-ORDER";
const META: &str = "BLK-MODEL-RESPONSE-SSE-META";
const CHOICES: &str = "BLK-MODEL-RESPONSE-SSE-CHOICES";
const ROLE: &str = "BLK-MODEL-RESPONSE-SSE-ROLE";
const DELTA: &str = "BLK-MODEL-RESPONSE-SSE-DELTA";
const TOOLS: &str = "BLK-MODEL-RESPONSE-SSE-TOOLS";
const LIMIT: usize = 16 * 1024 * 1024;
#[derive(Default)]
pub(super) struct Stream {
    pending: Vec<u8>,
    data: Vec<String>,
    total: usize,
    done: bool,
    id: Option<Value>,
    model: Option<Value>,
    text: String,
    thinking: String,
    tools: BTreeMap<u64, Value>,
    finish: Option<Value>,
    usage: Option<Value>,
}
impl Stream {
    pub fn feed(
        &mut self,
        bytes: &[u8],
        emit: &mut dyn FnMut(Value) -> Result<(), String>,
    ) -> Result<(), String> {
        self.total += bytes.len();
        if self.total > LIMIT {
            return Err("BLK-PROVIDER-LIMIT".into());
        }
        self.pending.extend_from_slice(bytes);
        while let Some(end) = self.pending.iter().position(|b| *b == b'\n') {
            let line: Vec<_> = self.pending.drain(..=end).collect();
            let line = std::str::from_utf8(&line[..line.len() - 1])
                .map_err(|_| UTF8)?
                .trim_end_matches('\r');
            if line.is_empty() {
                self.event(emit)?;
            } else if let Some(value) = line.strip_prefix("data:") {
                self.data
                    .push(value.strip_prefix(' ').unwrap_or(value).into());
            }
        }
        Ok(())
    }
    fn event(&mut self, emit: &mut dyn FnMut(Value) -> Result<(), String>) -> Result<(), String> {
        if self.data.is_empty() {
            return Ok(());
        }
        let data = std::mem::take(&mut self.data).join("\n");
        if self.done {
            return Err(ORDER.into());
        }
        if data == "[DONE]" {
            self.done = true;
            return Ok(());
        }
        let v = crate::strict_json::parse(data.as_bytes()).map_err(|_| JSON)?;
        for (slot, key) in [(&mut self.id, "id"), (&mut self.model, "model")] {
            if let Some(value) = v.get(key) {
                if slot.as_ref().is_some_and(|old| old != value) {
                    return Err(META.into());
                }
                *slot = Some(value.clone());
            }
        }
        if let Some(usage) = v.get("usage").filter(|v| !v.is_null()) {
            if self.usage.as_ref().is_some_and(|old| old != usage) {
                return Err(super::protocol::RESPONSE_USAGE_CHANGED.into());
            }
            self.usage = Some(usage.clone());
        }
        let choices = v["choices"]
            .as_array()
            .filter(|a| a.len() <= 1)
            .ok_or(CHOICES)?;
        let Some(c) = choices.first() else {
            return Ok(());
        };
        if c["index"].as_u64().is_some_and(|n| n != 0) {
            return Err(CHOICES.into());
        }
        if let Some(finish) = c.get("finish_reason").filter(|v| !v.is_null()) {
            if self.finish.as_ref().is_some_and(|f| f != finish) {
                return Err(ORDER.into());
            }
            self.finish = Some(finish.clone());
        }
        let d = &c["delta"];
        if self.finish.is_some()
            && c["finish_reason"].is_null()
            && ["content", "reasoning_content", "tool_calls"]
                .iter()
                .any(|key| d.get(key).is_some_and(|v| !v.is_null() && v != ""))
        {
            return Err(ORDER.into());
        }
        if let Some(role) = d.get("role").filter(|v| !v.is_null()) {
            if role != "assistant" {
                return Err(ROLE.into());
            }
        }
        for (field, kind, target) in [
            ("content", "text_delta", &mut self.text),
            ("reasoning_content", "thinking_delta", &mut self.thinking),
        ] {
            if let Some(value) = d.get(field).filter(|v| !v.is_null()) {
                let delta = value.as_str().ok_or(DELTA)?;
                target.push_str(delta);
                if target.len() > 2 * 1024 * 1024 {
                    return Err("BLK-PROVIDER-LIMIT".into());
                }
                if !delta.is_empty() {
                    emit(json!({"type":kind,"delta":delta}))?;
                }
            }
        }
        if let Some(calls) = d.get("tool_calls").filter(|v| !v.is_null()) {
            for t in calls.as_array().filter(|a| a.len() <= 8).ok_or(TOOLS)? {
                let index = t["index"].as_u64().filter(|n| *n < 8).ok_or(TOOLS)?;
                let tool = self.tools.entry(index).or_insert_with(
                    || json!({"id":"","type":"function","function":{"name":"","arguments":""}}),
                );
                if t.get("type").is_some_and(|v| v != "function") {
                    return Err(TOOLS.into());
                }
                for (key, target) in [("id", &mut tool["id"])] {
                    if let Some(value) = t.get(key) {
                        let s = value.as_str().ok_or(TOOLS)?;
                        let mut accumulated = target.as_str().ok_or(TOOLS)?.to_owned();
                        accumulated.push_str(s);
                        if accumulated.len() > 128 {
                            return Err(TOOLS.into());
                        }
                        *target = json!(accumulated);
                    }
                }
                for key in ["name", "arguments"] {
                    if let Some(value) = t["function"].get(key) {
                        let delta = value.as_str().ok_or(TOOLS)?;
                        let mut accumulated =
                            tool["function"][key].as_str().ok_or(TOOLS)?.to_owned();
                        accumulated.push_str(delta);
                        if accumulated.len() > if key == "name" { 64 } else { 2 * 1024 * 1024 } {
                            return Err("BLK-PROVIDER-LIMIT".into());
                        }
                        tool["function"][key] = json!(accumulated);
                        if !delta.is_empty() {
                            emit(
                                json!({"type":"toolcall_delta","index":index,"field":key,"delta":delta}),
                            )?;
                        }
                    }
                }
            }
        }
        Ok(())
    }
    pub fn metadata_snapshot(&self) -> Option<Vec<u8>> {
        // Preserve only provider-reported accounting on cancellation after the usage frame.
        let usage = self.usage.as_ref()?;
        let finish = self.finish.as_ref()?;
        serde_json::to_vec(&json!({"id":self.id.as_ref()?,"model":self.model.as_ref()?,"usage":usage,"choices":[{"finish_reason":finish}]})).ok()
    }
    pub fn complete(mut self) -> Result<Vec<u8>, String> {
        // A closed HTTP body is not proof of an uninterrupted provider stream.
        if !self.done || self.finish.is_none() || !self.pending.is_empty() || !self.data.is_empty()
        {
            return Err("BLK-MODEL-TRUNCATED-SSE".into());
        }
        let mut message = json!({"role":"assistant","content":self.text});
        if !self.thinking.is_empty() {
            message["reasoning_content"] = json!(self.thinking);
        }
        if !self.tools.is_empty() {
            message["tool_calls"] = json!(
                std::mem::take(&mut self.tools)
                    .into_values()
                    .collect::<Vec<_>>()
            );
        }
        let mut response = json!({"id":self.id.ok_or(META)?,"model":self.model.ok_or(META)?,"choices":[{"message":message,"finish_reason":self.finish.ok_or(ORDER)?}]});
        if let Some(usage) = self.usage {
            response["usage"] = usage;
        }
        serde_json::to_vec(&response).map_err(|_| JSON.into())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn official_null_role_terminal_chunk_remains_a_complete_generation() {
        let mut stream=Stream::default();
        let wire=concat!(
            "data: {\"id\":\"fixture\",\"model\":\"fixture\",\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\",\"content\":\"answer\"},\"finish_reason\":null}]}\n\n",
            "data: {\"id\":\"fixture\",\"model\":\"fixture\",\"choices\":[{\"index\":0,\"delta\":{\"role\":null,\"content\":\"\"},\"finish_reason\":\"stop\"}],\"usage\":{\"prompt_tokens\":1,\"completion_tokens\":2,\"total_tokens\":3}}\n\n",
            "data: [DONE]\n\n");
        stream.feed(wire.as_bytes(),&mut |_|Ok(())).expect("Official nullable role must be accepted");
        let response:Value=serde_json::from_slice(&stream.complete().unwrap()).unwrap();
        assert_eq!(response["choices"][0]["message"]["content"],"answer");
        assert_eq!(response["usage"]["completion_tokens"],2);
    }
    #[test]
    fn nullable_role_does_not_relax_non_null_roles_or_other_delta_validation() {
        for role in [json!("user"),json!("synthetic-private-role"),json!(1),json!(false),json!({})] {
            let wire=format!("data: {}\n\n",json!({"choices":[{"delta":{"role":role}}]}));
            assert_eq!(Stream::default().feed(wire.as_bytes(),&mut |_|Ok(())).unwrap_err(),ROLE);
        }
        let wire=format!("data: {}\n\n",json!({"choices":[{"delta":{"role":null,"content":[]}}]}));
        assert_eq!(Stream::default().feed(wire.as_bytes(),&mut |_|Ok(())).unwrap_err(),DELTA);
        let wire=format!("data: {}\n\n",json!({"choices":[{"delta":{"role":null,"tool_calls":[{"index":9}]}}]}));
        assert_eq!(Stream::default().feed(wire.as_bytes(),&mut |_|Ok(())).unwrap_err(),TOOLS);
        let mut incomplete=Stream::default();
        incomplete.feed(b"data: {\"id\":\"fixture\",\"model\":\"fixture\",\"choices\":[{\"delta\":{\"role\":null},\"finish_reason\":\"stop\"}]}\n\n",&mut |_|Ok(())).unwrap();
        assert_eq!(incomplete.complete().unwrap_err(),"BLK-MODEL-TRUNCATED-SSE");
    }
    #[test]
    fn malformed_stream_stages_return_only_fixed_diagnostics() {
        let cases:Vec<(&[u8],&str)>=vec![
            (b"data: \xff\n\n",UTF8),
            (b"data: {synthetic-private-json\n\n",JSON),
            (b"data: {\"synthetic-private-field\":true}\n\n",CHOICES),
            (b"data: {\"choices\":[{\"index\":1,\"delta\":{}}]}\n\n",CHOICES),
            (b"data: {\"id\":\"fixture\",\"choices\":[]}\n\ndata: {\"id\":\"synthetic-private-different\",\"choices\":[]}\n\n",META),
            (b"data: [DONE]\n\ndata: {\"choices\":[]}\n\n",ORDER),
            (b"data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\"}]}\n\ndata: {\"choices\":[{\"delta\":{\"content\":\"synthetic-private-content\"}}]}\n\n",ORDER),
        ];
        for (wire,expected) in cases {
            let error=Stream::default().feed(wire,&mut |_|Ok(())).unwrap_err();
            assert_eq!(error,expected);
            assert!(error.len()<64 && !error.contains("synthetic-private"));
        }
    }
    #[test]
    fn fragmented_utf8_and_reasoning_and_tools_are_assembled() {
        let wire = concat!(
            "data: {\"id\":\"r\",\"model\":\"m\",\"choices\":[{\"index\":0,\"delta\":{\"reasoning_content\":\"思考\",\"tool_calls\":[{\"index\":0,\"id\":\"c\",\"type\":\"function\",\"function\":{\"name\":\"tool\",\"arguments\":\"{\"}}]}}]}\r\n\r\n",
            "data: {\"id\":\"r\",\"model\":\"m\",\"choices\":[{\"index\":0,\"delta\":{\"tool_calls\":[{\"index\":0,\"function\":{\"arguments\":\"}\"}}]},\"finish_reason\":\"tool_calls\"}]}\n\n",
            "data: [DONE]\n\n"
        );
        let mut s = Stream::default();
        let mut deltas = vec![];
        for b in wire.as_bytes() {
            s.feed(&[*b], &mut |v| {
                deltas.push(v);
                Ok(())
            })
            .unwrap();
        }
        let v: Value = serde_json::from_slice(&s.complete().unwrap()).unwrap();
        assert_eq!(v["choices"][0]["message"]["reasoning_content"], "思考");
        assert_eq!(
            v["choices"][0]["message"]["tool_calls"][0]["function"]["arguments"],
            "{}"
        );
        assert_eq!(deltas[0]["type"], "thinking_delta");
    }
    #[test]
    fn incomplete_stream_is_not_a_generation() {
        let mut s = Stream::default();
        s.feed(b"data: {\"id\":\"r\",\"model\":\"m\",\"choices\":[{\"delta\":{\"content\":\"partial\"}}]}\n\n",&mut |_|Ok(())).unwrap();
        assert_eq!(s.complete().unwrap_err(), "BLK-MODEL-TRUNCATED-SSE");
    }
    #[test]
    fn changing_usage_is_a_fixed_usage_error_not_a_protocol_error() {
        let mut stream = Stream::default();
        stream.feed(b"data: {\"choices\":[],\"usage\":{\"prompt_tokens\":1}}\n\n", &mut |_| Ok(())).unwrap();
        assert_eq!(stream.feed(b"data: {\"choices\":[],\"usage\":{\"prompt_tokens\":2}}\n\n", &mut |_| Ok(())).unwrap_err(), "BLK-MODEL-RESPONSE-USAGE-CHANGED");
    }
    #[test]
    fn duplicate_usage_is_accepted_but_optional_detail_changes_remain_rejected() {
        let frame=b"data: {\"choices\":[],\"usage\":{\"prompt_tokens\":1,\"completion_tokens\":2,\"total_tokens\":3}}\n\n";
        let mut stream=Stream::default();
        stream.feed(frame,&mut |_|Ok(())).unwrap();
        stream.feed(frame,&mut |_|Ok(())).unwrap();
        assert_eq!(stream.feed(b"data: {\"choices\":[],\"usage\":{\"prompt_tokens\":1,\"completion_tokens\":2,\"total_tokens\":3,\"completion_tokens_details\":{\"reasoning_tokens\":1}}}\n\n",&mut |_|Ok(())).unwrap_err(),"BLK-MODEL-RESPONSE-USAGE-CHANGED");
    }
}
