use super::protocol::{INVALID, bounded, keys, parse, require};
use serde_json::{Value, json};
const STATE: &str = "BLK-WORKFLOW-STATE";
fn clear(r: &mut Value) {
    if let Some(o) = r.as_object_mut() {
        o.remove("active");
        o.remove("code");
    }
}
fn complete(r: &mut Value, state: &Value, index: usize, forward: bool) -> Result<(), String> {
    require(
        r["definition"]["steps"][index]["kind"] == "action" && r.get("active").is_some(),
        STATE,
    )?;
    bounded(state, 131072)?;
    if forward {
        r["receipts"][index] = json!({"status":"completed","before":r["state"],"after":state});
        r["cursor"] = json!(index + 1);
        r["forwardCursor"] = json!(index + 1);
        r["status"] = json!("ready");
    } else {
        r["receipts"][index]["status"] = json!("compensated");
        r["cursor"] = json!(index as i64 - 1);
        r["status"] = json!("compensating");
    }
    r["state"] = state.clone();
    clear(r);
    Ok(())
}
/// Apply only to an authoritative record while its native ledger lock is held.
pub fn transition(input: &Value, action: &Value) -> Result<Value, String> {
    let mut r = parse(input)?;
    bounded(action, 262144)?;
    require(action["revision"] == r["revision"], "BLK-WORKFLOW-CONFLICT")?;
    let kind = action["kind"].as_str().ok_or(INVALID)?;
    let mut fields = vec!["kind", "revision"];
    match kind {
        "complete" => fields.push("state"),
        "uncertain" => fields.push("code"),
        "decide" => fields.extend(["stepId", "decision"]),
        "resolve" => {
            fields.push("outcome");
            if action["outcome"] == "completed" {
                fields.push("state");
            }
        }
        _ => {}
    }
    keys(action, &fields, &[])?;
    let cursor = r["cursor"].as_i64().ok_or(INVALID)?;
    let forward = r["phase"] == "forward";
    let index = usize::try_from(cursor).ok();
    let step = index
        .and_then(|i| r["definition"]["steps"].get(i))
        .cloned()
        .unwrap_or(Value::Null);
    let live = r["status"] == if forward { "ready" } else { "compensating" };
    match kind {
        "begin" => {
            require(
                live && step["kind"] == "action" && (forward || step["compensate"] == true),
                STATE,
            )?;
            r["active"] = json!({"stepId":step["stepId"],"direction":r["phase"],
                "effectKey":format!("{}:{}:{}",r["taskId"].as_str().ok_or(INVALID)?,step["stepId"].as_str().ok_or(INVALID)?,r["phase"].as_str().ok_or(INVALID)?)});
            r["status"] = json!(if forward { "executing" } else { "undoing" });
        }
        "complete" => {
            require(
                matches!(r["status"].as_str(), Some("executing" | "undoing")),
                STATE,
            )?;
            complete(&mut r, &action["state"], index.ok_or(STATE)?, forward)?;
        }
        "uncertain" => {
            require(
                matches!(r["status"].as_str(), Some("executing" | "undoing")),
                STATE,
            )?;
            r["status"] = json!("uncertain");
            r["code"] = action["code"].clone();
        }
        "checkpoint" => {
            require(forward && live && step["kind"] == "checkpoint", STATE)?;
            r["receipts"][index.ok_or(STATE)?]["status"] = json!("completed");
            r["cursor"] = json!(cursor + 1);
            r["forwardCursor"] = json!(cursor + 1);
        }
        "await-approval" => {
            require(forward && live && step["kind"] == "approval", STATE)?;
            r["status"] = json!("awaiting-approval");
        }
        "decide" => {
            require(
                r["status"] == "awaiting-approval"
                    && step["kind"] == "approval"
                    && step["stepId"] == action["stepId"]
                    && matches!(action["decision"].as_str(), Some("approve" | "reject")),
                STATE,
            )?;
            if action["decision"] == "approve" {
                r["receipts"][index.ok_or(STATE)?]["status"] = json!("approved");
                r["cursor"] = json!(cursor + 1);
                r["forwardCursor"] = json!(cursor + 1);
                r["status"] = json!("ready");
            } else {
                r["receipts"][index.ok_or(STATE)?]["status"] = json!("rejected");
                r["cursor"] = json!(cursor - 1);
                r["phase"] = json!("rollback");
                r["status"] = json!("compensating");
            }
        }
        "skip" => {
            require(
                !forward
                    && live
                    && !step.is_null()
                    && (step["kind"] != "action" || step["compensate"] == false),
                STATE,
            )?;
            if step["kind"] == "action" {
                r["receipts"][index.ok_or(STATE)?]["status"] = json!("skipped");
            }
            r["cursor"] = json!(cursor - 1);
        }
        "finish" => {
            require(
                live && if forward {
                    cursor == r["definition"]["steps"].as_array().ok_or(INVALID)?.len() as i64
                } else {
                    cursor == -1
                },
                STATE,
            )?;
            r["status"] = json!(if forward { "completed" } else { "compensated" });
        }
        "pause" => {
            require(live, STATE)?;
            r["status"] = json!("paused");
        }
        "resume" => {
            require(r["status"] == "paused", STATE)?;
            r["status"] = json!(if forward { "ready" } else { "compensating" });
        }
        "rollback" => {
            require(
                forward
                    && matches!(
                        r["status"].as_str(),
                        Some("ready" | "paused" | "awaiting-approval" | "completed")
                    ),
                STATE,
            )?;
            if r["status"] == "awaiting-approval" {
                r["receipts"][index.ok_or(STATE)?]["status"] = json!("rejected");
            }
            r["cursor"] = json!(cursor - 1);
            r["phase"] = json!("rollback");
            r["status"] = json!("compensating");
        }
        "resolve" => {
            require(
                matches!(
                    r["status"].as_str(),
                    Some("executing" | "undoing" | "uncertain")
                ) && r.get("active").is_some()
                    && matches!(
                        action["outcome"].as_str(),
                        Some("completed" | "not-executed")
                    ),
                STATE,
            )?;
            let resolution = json!({"revision":r["revision"],"stepId":r["active"]["stepId"],"direction":r["active"]["direction"],"outcome":action["outcome"]});
            r["resolutions"]
                .as_array_mut()
                .ok_or(INVALID)?
                .push(resolution);
            if action["outcome"] == "completed" {
                complete(&mut r, &action["state"], index.ok_or(STATE)?, forward)?;
            } else {
                clear(&mut r);
                r["status"] = json!(if forward { "ready" } else { "compensating" });
            }
        }
        _ => return Err(INVALID.into()),
    }
    r["revision"] = json!(r["revision"].as_u64().ok_or(INVALID)? + 1);
    parse(&r)
}
