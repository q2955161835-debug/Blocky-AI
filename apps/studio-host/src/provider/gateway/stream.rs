use serde_json::{Value, json};
use std::collections::BTreeMap;
const ERROR: &str = "BLK-MODEL-RESPONSE-SSE";
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
                .map_err(|_| ERROR)?
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
            return Err(ERROR.into());
        }
        if data == "[DONE]" {
            self.done = true;
            return Ok(());
        }
        let v = crate::strict_json::parse(data.as_bytes()).map_err(|_| ERROR)?;
        for (slot, key) in [(&mut self.id, "id"), (&mut self.model, "model")] {
            if let Some(value) = v.get(key) {
                if slot.as_ref().is_some_and(|old| old != value) {
                    return Err(ERROR.into());
                }
                *slot = Some(value.clone());
            }
        }
        if let Some(usage) = v.get("usage").filter(|v| !v.is_null()) {
            if self.usage.as_ref().is_some_and(|old| old != usage) {
                return Err(super::protocol::RESPONSE_USAGE.into());
            }
            self.usage = Some(usage.clone());
        }
        let choices = v["choices"]
            .as_array()
            .filter(|a| a.len() <= 1)
            .ok_or(ERROR)?;
        let Some(c) = choices.first() else {
            return Ok(());
        };
        if c["index"].as_u64().is_some_and(|n| n != 0) {
            return Err(ERROR.into());
        }
        if let Some(finish) = c.get("finish_reason").filter(|v| !v.is_null()) {
            if self.finish.as_ref().is_some_and(|f| f != finish) {
                return Err(ERROR.into());
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
            return Err(ERROR.into());
        }
        if let Some(role) = d.get("role") {
            if role != "assistant" {
                return Err(ERROR.into());
            }
        }
        for (field, kind, target) in [
            ("content", "text_delta", &mut self.text),
            ("reasoning_content", "thinking_delta", &mut self.thinking),
        ] {
            if let Some(value) = d.get(field).filter(|v| !v.is_null()) {
                let delta = value.as_str().ok_or(ERROR)?;
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
            for t in calls.as_array().filter(|a| a.len() <= 8).ok_or(ERROR)? {
                let index = t["index"].as_u64().filter(|n| *n < 8).ok_or(ERROR)?;
                let tool = self.tools.entry(index).or_insert_with(
                    || json!({"id":"","type":"function","function":{"name":"","arguments":""}}),
                );
                if t.get("type").is_some_and(|v| v != "function") {
                    return Err(ERROR.into());
                }
                for (key, target) in [("id", &mut tool["id"])] {
                    if let Some(value) = t.get(key) {
                        let s = value.as_str().ok_or(ERROR)?;
                        let mut accumulated = target.as_str().ok_or(ERROR)?.to_owned();
                        accumulated.push_str(s);
                        if accumulated.len() > 128 {
                            return Err(ERROR.into());
                        }
                        *target = json!(accumulated);
                    }
                }
                for key in ["name", "arguments"] {
                    if let Some(value) = t["function"].get(key) {
                        let delta = value.as_str().ok_or(ERROR)?;
                        let mut accumulated =
                            tool["function"][key].as_str().ok_or(ERROR)?.to_owned();
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
        let mut response = json!({"id":self.id.ok_or(ERROR)?,"model":self.model.ok_or(ERROR)?,"choices":[{"message":message,"finish_reason":self.finish.ok_or(ERROR)?}]});
        if let Some(usage) = self.usage {
            response["usage"] = usage;
        }
        serde_json::to_vec(&response).map_err(|_| ERROR.into())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
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
        assert_eq!(stream.feed(b"data: {\"choices\":[],\"usage\":{\"prompt_tokens\":2}}\n\n", &mut |_| Ok(())).unwrap_err(), "BLK-MODEL-RESPONSE-USAGE");
    }
}
