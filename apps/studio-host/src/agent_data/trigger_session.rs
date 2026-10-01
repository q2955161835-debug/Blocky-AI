//! Private long-lived CLI transport; the initial consent digest fixes project/session.
use super::*;
use std::io::{BufRead, BufReader, Read, Write};
const WIRE: &str = "blocky.trigger-session/v1";
const FRAME: usize = 262144;
// A poll can carry 128 maximal 32KiB JSON payloads plus bounded claim metadata.
const RESPONSE_FRAME: usize = 5 * 1024 * 1024;
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Context {
    pub schema_version: String,
    pub request_id: String,
    pub project_id: String,
    pub session_id: String,
}
impl Context {
    pub fn validate(&self) -> Result<(), String> {
        validate_context(&self.project_id, &self.session_id)?;
        if self.schema_version != WIRE || !stable(&self.request_id) {
            return Err(INVALID.into());
        }
        Ok(())
    }
    pub fn preflight(&self) -> Result<Value, String> {
        self.validate()?;
        Ok(
            json!({"requestDigest":digest(self)?,"projectId":self.project_id,"sessionId":self.session_id,"capabilities":["trigger-config","timer-claim","trigger-complete","external-receiver"],"maximumSeconds":1800}),
        )
    }
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Initial {
    schema_version: String,
    request_id: String,
    project_id: String,
    session_id: String,
    approved_context_digest: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Frame {
    operation: String,
    request_id: u64,
    #[serde(default, deserialize_with = "super::present")]
    request: Option<Value>,
}
fn read(input: &mut impl BufRead) -> Result<Option<Value>, String> {
    let mut bytes = Vec::new();
    let n = Read::by_ref(input)
        .take(FRAME as u64 + 1)
        .read_until(b'\n', &mut bytes)
        .map_err(|_| "BLK-TRIGGER-CHANNEL")?;
    if n == 0 {
        return Ok(None);
    }
    let result = if n > FRAME || bytes.last() != Some(&b'\n') {
        Err("BLK-TRIGGER-LIMIT".into())
    } else {
        crate::strict_json::parse(&bytes)
    };
    crate::secret_store::wipe(&mut bytes);
    result.map(Some)
}
fn emit(output: &mut impl Write, kind: &str, id: u64, value: Value) -> Result<(), String> {
    let mut bytes =
        serde_json::to_vec(&json!({"schemaVersion":WIRE,"type":kind,"requestId":id,"value":value}))
            .map_err(|_| INVALID)?;
    if bytes.len() >= RESPONSE_FRAME {
        crate::secret_store::wipe(&mut bytes);
        return Err("BLK-TRIGGER-LIMIT".into());
    }
    bytes.push(b'\n');
    let result = output
        .write_all(&bytes)
        .and_then(|_| output.flush())
        .map_err(|_| "BLK-TRIGGER-CHANNEL".into());
    crate::secret_store::wipe(&mut bytes);
    result
}
pub fn serve(root: PathBuf, input: impl Read + Send + 'static, output: &mut impl Write) -> i32 {
    let host = AgentData::new(root.clone());
    let (send, receive) = std::sync::mpsc::sync_channel(1);
    std::thread::spawn(move || {
        let mut input = BufReader::new(input);
        loop {
            let next = read(&mut input);
            let terminal = !matches!(next, Ok(Some(_)));
            if send.send(next).is_err() || terminal {
                break;
            }
        }
    });
    let deadline = Instant::now() + Duration::from_secs(1800);
    let mut last = 0;
    let result = (|| -> Result<(), String> {
        let initial = receive
            .recv_timeout(Duration::from_secs(30))
            .map_err(|_| "BLK-TRIGGER-CHANNEL")??
            .ok_or(INVALID)?;
        let initial: Initial = serde_json::from_value(initial).map_err(|_| INVALID)?;
        let context = Context {
            schema_version: initial.schema_version,
            request_id: initial.request_id,
            project_id: initial.project_id,
            session_id: initial.session_id,
        };
        context.validate()?;
        let d = digest(&context)?;
        if d != initial.approved_context_digest {
            return Err(PERMISSION.into());
        }
        crate::approval_ledger::consume(
            &root.join("approvals"),
            &format!(
                "trigger-session/{}/{}",
                context.project_id, context.request_id
            ),
            &d,
        )?;
        let token = host.authorize(&context.project_id, &context.session_id)?;
        emit(
            output,
            "ready",
            0,
            json!({"projectId":context.project_id,"sessionId":context.session_id}),
        )?;
        loop {
            let next = receive
                .recv_timeout(deadline.saturating_duration_since(Instant::now()))
                .map_err(|_| "BLK-TRIGGER-CHANNEL")??;
            let Some(next) = next else { return Ok(()) };
            let f: Frame = serde_json::from_value(next).map_err(|_| INVALID)?;
            if f.request_id != last + 1 || f.request_id > 4096 {
                return Err(INVALID.into());
            }
            last = f.request_id;
            if f.operation == "close" {
                if f.request.is_some() {
                    return Err(INVALID.into());
                }
                host.shutdown()?;
                emit(output, "closed", last, json!({"closed":true}))?;
                return Ok(());
            }
            let result = (|| {
                let request = f.request.ok_or(INVALID)?;
                if request["projectId"] != context.project_id
                    || request["sessionId"] != context.session_id
                {
                    return Err(PERMISSION.into());
                }
                match f.operation.as_str() {
                    "manage" => {
                        let r: trigger_store::Request =
                            serde_json::from_value(request).map_err(|_| INVALID)?;
                        host.manage_trigger(&token, &r)
                    }
                    "receiver" => {
                        let r: ReceiverRequest =
                            serde_json::from_value(request).map_err(|_| INVALID)?;
                        host.trigger_receiver(&token, &r)
                    }
                    _ => Err(INVALID.into()),
                }
            })();
            match result {
                Ok(v) => emit(output, "result", last, v)?,
                Err(code) => emit(output, "error", last, json!({"code":code}))?,
            }
        }
    })();
    let _ = host.shutdown();
    match result {
        Ok(()) => 0,
        Err(code) => {
            let _ = emit(output, "error", last, json!({"code":code}));
            1
        }
    }
}
pub fn main() -> i32 {
    let root = match crate::profile::cli_root() {
        Ok(r) => r.join("user/agent-memory"),
        Err(_) => return 1,
    };
    serve(root, std::io::stdin(), &mut std::io::stdout())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn root() -> tempfile::TempDir {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../try/agent-capability-upgrade/trigger-session-tests");
        std::fs::create_dir_all(&root).unwrap();
        tempfile::tempdir_in(root.canonicalize().unwrap()).unwrap()
    }
    fn context() -> Context {
        Context {
            schema_version: WIRE.into(),
            request_id: "session-consent".into(),
            project_id: "project-one".into(),
            session_id: "session-one".into(),
        }
    }
    fn input(frames: Vec<Value>) -> std::io::Cursor<Vec<u8>> {
        let mut bytes = Vec::new();
        for f in frames {
            bytes.extend(serde_json::to_vec(&f).unwrap());
            bytes.push(b'\n');
        }
        std::io::Cursor::new(bytes)
    }
    fn results(bytes: &[u8]) -> Vec<Value> {
        std::str::from_utf8(bytes)
            .unwrap()
            .lines()
            .map(|s| serde_json::from_str(s).unwrap())
            .collect()
    }
    #[test]
    fn approved_session_is_bound_and_consumes_context_once() {
        let tmp = root();
        let root = tmp.path().join("user/agent-memory");
        let context = context();
        let d = digest(&context).unwrap();
        crate::approval_ledger::issue(
            &root.join("approvals"),
            "trigger-session/project-one/session-consent",
            &d,
        )
        .unwrap();
        let initial = json!({"schemaVersion":WIRE,"requestId":context.request_id,"projectId":context.project_id,"sessionId":context.session_id,"approvedContextDigest":d});
        let list = json!({"schemaVersion":"blocky.trigger-request/v1","requestId":"list-one","projectId":"project-one","sessionId":"session-one","action":"list"});
        let mut other = list.clone();
        other["projectId"] = json!("project-other");
        let mut output = Vec::new();
        assert_eq!(
            serve(
                root.clone(),
                input(vec![
                    initial.clone(),
                    json!({"operation":"manage","requestId":1,"request":list}),
                    json!({"operation":"manage","requestId":2,"request":other}),
                    json!({"operation":"close","requestId":3})
                ]),
                &mut output
            ),
            0
        );
        let r = results(&output);
        assert_eq!(r[0]["type"], "ready");
        assert_eq!(r[1]["type"], "result");
        assert_eq!(r[2]["value"]["code"], PERMISSION);
        assert_eq!(r[3]["type"], "closed");
        output.clear();
        assert_eq!(serve(root, input(vec![initial]), &mut output), 1);
        assert_eq!(results(&output)[0]["value"]["code"], PERMISSION);
    }
    #[test]
    fn approval_and_frame_errors_fail_closed() {
        let tmp = root();
        let root = tmp.path().join("user/agent-memory");
        let mut output = Vec::new();
        assert_eq!(
            serve(
                root.clone(),
                input(vec![
                    json!({"schemaVersion":WIRE,"requestId":"session-consent","projectId":"project-one","sessionId":"session-one","approvedContextDigest":"unapproved"})
                ]),
                &mut output
            ),
            1
        );
        assert_eq!(results(&output)[0]["type"], "error");
        let context = context();
        let d = digest(&context).unwrap();
        crate::approval_ledger::issue(
            &root.join("approvals"),
            "trigger-session/project-one/session-consent",
            &d,
        )
        .unwrap();
        output.clear();
        assert_eq!(
            serve(
                root,
                input(vec![
                    json!({"schemaVersion":WIRE,"requestId":"session-consent","projectId":"project-one","sessionId":"session-one","approvedContextDigest":d}),
                    json!({"operation":"close","requestId":2})
                ]),
                &mut output
            ),
            1
        );
        let r = results(&output);
        assert_eq!(r[0]["type"], "ready");
        assert_eq!(r[1]["type"], "error");
        let mut input = std::io::Cursor::new(vec![b'x'; FRAME + 1]);
        assert!(read(&mut input).is_err());
    }
    #[test]
    fn full_bounded_poll_batch_fits_private_response_frame() {
        let events:Vec<Value>=(0..128).map(|_|json!({"occurrence":{"occurrenceId":"x".repeat(512),"moduleId":"module-one"},"payload":"x".repeat(32766)})).collect();
        let mut bytes = Vec::new();
        emit(&mut bytes, "result", 1, json!({"events":events})).unwrap();
        assert!(bytes.len() > FRAME);
        assert!(bytes.len() < RESPONSE_FRAME);
        assert_eq!(
            results(&bytes)[0]["value"]["events"]
                .as_array()
                .unwrap()
                .len(),
            128
        );
    }
}
