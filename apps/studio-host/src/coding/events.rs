use super::CodingStart;
use serde_json::{Value, json};

const ERROR: &str = "BLK-CODING-WIRE";
const TEXT_LIMIT: usize = 2 * 1024 * 1024;
#[derive(Default)]
struct TextTrack {
    streamed: String,
    consumed: usize,
    shown: String,
}
impl TextTrack {
    fn append(&mut self, text: &str) -> Result<(), String> {
        if self.shown.len() + text.len() > TEXT_LIMIT {
            return Err("BLK-CODING-BUDGET".into());
        }
        self.shown.push_str(text);
        if crate::builder::contains_credentials(&json!(self.shown)) {
            return Err("BLK-CODING-INPUT".into());
        }
        Ok(())
    }
    fn settle(&mut self) -> Result<(), String> {
        if self.consumed != self.streamed.len() {
            return Err(ERROR.into());
        }
        self.streamed.clear();
        self.consumed = 0;
        Ok(())
    }
    fn remainder<'a>(&mut self, text: &'a str) -> Result<&'a str, String> {
        let pending = &self.streamed[self.consumed..];
        let overlap = pending.len().min(text.len());
        if pending.as_bytes()[..overlap] != text.as_bytes()[..overlap] {
            return Err(ERROR.into());
        }
        self.consumed += overlap;
        text.get(overlap..).ok_or(ERROR.into())
    }
}
/// Native provider deltas and worker tools share a public sequence. Worker final
/// text is checked against the real deltas, so it cannot replay an answer twice.
pub(super) struct EventLog {
    request: String,
    project: String,
    worker_sequence: u64,
    text: TextTrack,
    thinking: TextTrack,
    pub events: Vec<Value>,
}
impl EventLog {
    pub fn new(start: &CodingStart) -> Self {
        Self {
            request: start.request_id.clone(),
            project: start.project_id.clone(),
            worker_sequence: 0,
            text: TextTrack::default(),
            thinking: TextTrack::default(),
            events: Vec::new(),
        }
    }
    pub fn begin_generation(&mut self) -> Result<(), String> {
        self.text.settle()?;
        self.thinking.settle()
    }
    fn publish(
        &mut self,
        mut event: Value,
        emit: &mut dyn FnMut(Value) -> Result<(), String>,
    ) -> Result<(), String> {
        if self.events.len() >= 262144 {
            return Err("BLK-CODING-BUDGET".into());
        }
        event["sequence"] = json!(self.events.len() + 1);
        emit(event.clone())?;
        self.events.push(event);
        Ok(())
    }
    pub fn delta(
        &mut self,
        delta: Value,
        emit: &mut dyn FnMut(Value) -> Result<(), String>,
    ) -> Result<(), String> {
        let kind = match delta["type"].as_str() {
            Some("text_delta") => "text.delta",
            Some("thinking_delta") => "thinking.delta",
            Some("toolcall_delta") => return Ok(()), // Dispatch only validated complete calls in the worker.
            _ => return Err(ERROR.into()),
        };
        let text = delta["delta"].as_str().ok_or(ERROR)?;
        let track = if kind == "text.delta" {
            &mut self.text
        } else {
            &mut self.thinking
        };
        track.append(text)?;
        track.streamed.push_str(text);
        let mut chunks = Vec::new();
        let mut start = 0;
        let mut length = 0;
        for (index, character) in text.char_indices() {
            if length + character.len_utf16() > 16384 {
                chunks.push(&text[start..index]);
                start = index;
                length = 0;
            }
            length += character.len_utf16();
        }
        if start < text.len() {
            chunks.push(&text[start..]);
        }
        for chunk in chunks {
            self.publish(json!({"schemaVersion":"blocky.coding-event/v1","requestId":self.request,"projectId":self.project,"kind":kind,"text":chunk}), emit)?;
        }
        Ok(())
    }
    pub fn worker(
        &mut self,
        mut event: Value,
        changes: &[Value],
        emit: &mut dyn FnMut(Value) -> Result<(), String>,
    ) -> Result<(), String> {
        let fields = [
            "schemaVersion",
            "requestId",
            "projectId",
            "sequence",
            "kind",
            "tool",
            "callId",
            "text",
            "code",
            "change",
            "command",
            "exitCode",
        ];
        if event
            .as_object()
            .is_none_or(|e| e.keys().any(|k| !fields.contains(&k.as_str())))
            || event["schemaVersion"] != "blocky.coding-event/v1"
            || event["requestId"] != self.request
            || event["projectId"] != self.project
            || event["sequence"].as_u64() != Some(self.worker_sequence + 1)
            || crate::builder::contains_credentials(&event)
        {
            return Err(ERROR.into());
        }
        if event
            .get("tool")
            .is_some_and(|tool| tool.as_str().is_none_or(|t| !super::TOOLS.contains(&t)))
        {
            return Err(ERROR.into());
        }
        if event
            .get("callId")
            .is_some_and(|id| id.as_str().is_none_or(|s| s.is_empty() || s.len() > 128))
        {
            return Err(ERROR.into());
        }
        if event.get("code").is_some_and(|code| {
            code.as_str().is_none_or(|s| {
                s.len() > 128
                    || !s.starts_with("BLK-")
                    || !s
                        .bytes()
                        .all(|b| b.is_ascii_uppercase() || b.is_ascii_digit() || b == b'-')
            })
        }) {
            return Err(ERROR.into());
        }
        if let Some(command) = event.get("command") {
            let command = command.as_str().ok_or(ERROR)?;
            if command != "--version" {
                let words: Vec<_> = command.split(' ').collect();
                if command.len() > 96
                    || words.is_empty()
                    || words.len() > 3
                    || words.iter().any(|w| {
                        w.is_empty()
                            || !w.as_bytes()[0].is_ascii_lowercase()
                            || !w
                                .bytes()
                                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
                    })
                {
                    return Err(ERROR.into());
                }
            }
        }
        if event
            .get("exitCode")
            .is_some_and(|code| code.as_i64().is_none_or(|n| i32::try_from(n).is_err()))
        {
            return Err(ERROR.into());
        }
        if let Some(text) = event.get("text") {
            super::process::bounded_text(text, 16384)?;
        }
        self.worker_sequence += 1;
        match event["kind"].as_str() {
            Some("text.delta" | "thinking.delta") => {
                let track = if event["kind"] == "text.delta" {
                    &mut self.text
                } else {
                    &mut self.thinking
                };
                let remaining = track
                    .remainder(event["text"].as_str().ok_or(ERROR)?)?
                    .to_owned();
                if remaining.is_empty() {
                    return Ok(());
                }
                track.append(&remaining)?;
                event["text"] = json!(remaining);
            }
            Some("tool.started" | "tool.completed" | "tool.failed") => {}
            Some("file.changed") if changes.contains(&event["change"]) => {}
            _ => return Err(ERROR.into()),
        }
        self.publish(event, emit)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn log() -> EventLog {
        EventLog {
            request: "r1".into(),
            project: "p1".into(),
            worker_sequence: 0,
            text: TextTrack::default(),
            thinking: TextTrack::default(),
            events: Vec::new(),
        }
    }
    fn worker(sequence: u64, kind: &str, text: &str) -> Value {
        json!({"schemaVersion":"blocky.coding-event/v1","requestId":"r1","projectId":"p1","sequence":sequence,"kind":kind,"text":text})
    }
    #[test]
    fn real_deltas_keep_public_order_and_worker_final_does_not_replay() {
        let mut log = log();
        let mut emitted = Vec::new();
        let mut emit = |event| {
            emitted.push(event);
            Ok(())
        };
        log.begin_generation().unwrap();
        log.delta(json!({"type":"thinking_delta","delta":"核对"}), &mut emit)
            .unwrap();
        log.delta(json!({"type":"text_delta","delta":"你好😀"}), &mut emit)
            .unwrap();
        log.worker(worker(1, "thinking.delta", "核对"), &[], &mut emit)
            .unwrap();
        log.worker(worker(2, "text.delta", "你好"), &[], &mut emit)
            .unwrap();
        log.worker(worker(3, "text.delta", "😀"), &[], &mut emit)
            .unwrap();
        log.worker(json!({"schemaVersion":"blocky.coding-event/v1","requestId":"r1","projectId":"p1","sequence":4,"kind":"tool.failed","tool":"blocky_cli","callId":"c1","command":"project compile","exitCode":1,"code":"BLK-PATCH-001"}), &[], &mut emit).unwrap();
        log.begin_generation().unwrap();
        log.worker(worker(5, "text.delta", "已修正"), &[], &mut emit)
            .unwrap();
        assert_eq!(log.events.len(), 4);
        assert_eq!(
            log.events
                .iter()
                .map(|e| e["sequence"].as_u64().unwrap())
                .collect::<Vec<_>>(),
            vec![1, 2, 3, 4]
        );
        assert_eq!(log.text.shown, "你好😀已修正");
        assert_eq!(log.events, emitted);
    }
    #[test]
    fn mismatched_replay_and_incomplete_worker_consumption_are_rejected() {
        let mut log = log();
        let mut emit = |_| Ok(());
        log.delta(json!({"type":"text_delta","delta":"真实文本"}), &mut emit)
            .unwrap();
        assert!(log.begin_generation().is_err());
        assert!(
            log.worker(worker(1, "text.delta", "不同文本"), &[], &mut emit)
                .is_err()
        );
    }
    #[test]
    fn large_delta_splits_unicode_safely_and_cancellation_keeps_emitted_prefix() {
        let mut log = log();
        let text = "😀".repeat(9000);
        let mut emit = |_| Ok(());
        log.delta(json!({"type":"text_delta","delta":text}), &mut emit)
            .unwrap();
        assert_eq!(log.events.len(), 2);
        assert_eq!(
            log.events
                .iter()
                .map(|e| e["text"].as_str().unwrap())
                .collect::<String>(),
            text
        );
        assert!(
            log.events
                .iter()
                .all(|e| e["text"].as_str().unwrap().encode_utf16().count() <= 16384)
        );
        // A failed provider has no final worker replay; its public trace is retained.
        assert_eq!(log.text.shown, text);
    }
}
