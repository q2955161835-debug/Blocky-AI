//! Strict native counterpart of runtime-core/workflow/protocol.ts.
use serde_json::{Value, json};
pub(super) const INVALID: &str = "BLK-WORKFLOW-INVALID";
pub(super) const LIMIT: &str = "BLK-WORKFLOW-LIMIT";
pub(super) const STATE_LIMIT: usize = 8 * 1024 * 1024;
pub(super) const RECORD_LIMIT: usize = 16 * 1024 * 1024;
pub(super) fn require(ok: bool, code: &str) -> Result<(), String> {
    if ok { Ok(()) } else { Err(code.into()) }
}
pub(super) fn keys(v: &Value, required: &[&str], optional: &[&str]) -> Result<(), String> {
    let obj = v.as_object().ok_or(INVALID)?;
    require(
        required.iter().all(|k| obj.contains_key(*k))
            && obj
                .keys()
                .all(|k| required.contains(&k.as_str()) || optional.contains(&k.as_str())),
        INVALID,
    )
}
pub(super) fn stable(value: &str) -> bool {
    value.len() <= 128 && crate::project_store::stable(value)
}
fn id(v: &Value) -> bool {
    v.as_str().is_some_and(stable)
}
pub(super) fn bounded(v: &Value, limit: usize) -> Result<(), String> {
    fn walk(v: &Value, depth: usize, nodes: &mut usize) -> Result<(), String> {
        *nodes += 1;
        require(depth <= 32 && *nodes <= 50_000, LIMIT)?;
        match v {
            Value::Array(a) => {
                for item in a {
                    walk(item, depth + 1, nodes)?;
                }
            }
            Value::Object(o) => {
                for item in o.values() {
                    walk(item, depth + 1, nodes)?;
                }
            }
            _ => {}
        }
        Ok(())
    }
    walk(v, 0, &mut 0)?;
    require(
        serde_json::to_vec(v).map_err(|_| INVALID)?.len() <= limit,
        LIMIT,
    )
}
pub(super) fn definition(v: &Value) -> Result<(), String> {
    bounded(v, 32768)?;
    keys(
        v,
        &[
            "projectId",
            "moduleId",
            "blockId",
            "planDigest",
            "runtimeVersion",
            "steps",
        ],
        &[],
    )?;
    require(
        id(&v["projectId"]) && id(&v["moduleId"]) && id(&v["blockId"]) && v["runtimeVersion"] == 1,
        INVALID,
    )?;
    require(
        v["planDigest"].as_str().is_some_and(|s| {
            s.len() == 64
                && s.bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        }),
        INVALID,
    )?;
    let steps = v["steps"].as_array().ok_or(INVALID)?;
    require((1..=64).contains(&steps.len()), LIMIT)?;
    let mut ids = std::collections::HashSet::new();
    for step in steps {
        let fields = match step["kind"].as_str() {
            Some("action") => vec!["stepId", "kind", "compensate"],
            Some("approval") => vec!["stepId", "kind", "label"],
            Some("checkpoint") => vec!["stepId", "kind"],
            _ => return Err(INVALID.into()),
        };
        keys(step, &fields, &[])?;
        require(
            id(&step["stepId"]) && ids.insert(step["stepId"].as_str().ok_or(INVALID)?),
            INVALID,
        )?;
        match step["kind"].as_str() {
            Some("action") => require(step["compensate"].is_boolean(), INVALID)?,
            Some("approval") => require(
                step["label"]
                    .as_str()
                    .is_some_and(|s| !s.is_empty() && s.len() <= 1000 && !s.contains('\0')),
                INVALID,
            )?,
            _ => {}
        }
    }
    Ok(())
}
pub fn parse(v: &Value) -> Result<Value, String> {
    bounded(v, RECORD_LIMIT)?;
    keys(
        v,
        &[
            "schemaVersion",
            "taskId",
            "definition",
            "revision",
            "cursor",
            "forwardCursor",
            "phase",
            "status",
            "state",
            "receipts",
            "resolutions",
        ],
        &["active", "code"],
    )?;
    require(
        v["schemaVersion"] == "blocky.workflow/v1" && id(&v["taskId"]),
        INVALID,
    )?;
    let revision = v["revision"]
        .as_u64()
        .filter(|n| (1..=65535).contains(n))
        .ok_or(INVALID)?;
    definition(&v["definition"])?;
    let steps = v["definition"]["steps"].as_array().ok_or(INVALID)?;
    let count = steps.len() as i64;
    let cursor = v["cursor"]
        .as_i64()
        .filter(|c| (-1..=count).contains(c))
        .ok_or(INVALID)?;
    let forward = v["forwardCursor"]
        .as_i64()
        .filter(|c| (0..=count).contains(c))
        .ok_or(INVALID)?;
    let phase = v["phase"].as_str().ok_or(INVALID)?;
    require(matches!(phase, "forward" | "rollback"), INVALID)?;
    require(
        if phase == "forward" {
            cursor == forward
        } else {
            cursor < forward
        },
        INVALID,
    )?;
    let status = v["status"].as_str().ok_or(INVALID)?;
    require(
        matches!(
            status,
            "ready"
                | "executing"
                | "awaiting-approval"
                | "paused"
                | "compensating"
                | "undoing"
                | "uncertain"
                | "completed"
                | "compensated"
        ),
        INVALID,
    )?;
    bounded(&v["state"], STATE_LIMIT)?;
    let receipts = v["receipts"]
        .as_array()
        .filter(|a| a.len() == steps.len())
        .ok_or(INVALID)?;
    for (index, (receipt, step)) in receipts.iter().zip(steps).enumerate() {
        keys(receipt, &["status"], &["before", "after"])?;
        let state = receipt["status"].as_str().ok_or(INVALID)?;
        let kind = step["kind"].as_str().ok_or(INVALID)?;
        let compensates = step["compensate"] == true;
        let allowed = match kind {
            "action" => vec![
                "pending",
                "completed",
                if compensates {
                    "compensated"
                } else {
                    "skipped"
                },
            ],
            "approval" => vec!["pending", "approved", "rejected"],
            _ => vec!["pending", "completed"],
        };
        require(allowed.contains(&state), INVALID)?;
        let frame = kind == "action" && state != "pending";
        require(
            receipt.get("before").is_some() == frame && receipt.get("after").is_some() == frame,
            INVALID,
        )?;
        if frame {
            bounded(&receipt["before"], STATE_LIMIT)?;
            bounded(&receipt["after"], STATE_LIMIT)?;
        }
        if (index as i64) < forward {
            let expected = if kind == "approval" {
                "approved"
            } else if kind == "action" && phase == "rollback" && (index as i64) > cursor {
                if compensates {
                    "compensated"
                } else {
                    "skipped"
                }
            } else {
                "completed"
            };
            require(state == expected, INVALID)?;
        } else {
            require(
                state == "pending"
                    || (phase == "rollback"
                        && index as i64 == forward
                        && kind == "approval"
                        && state == "rejected"),
                INVALID,
            )?;
        }
    }
    let current = usize::try_from(cursor).ok().and_then(|c| steps.get(c));
    require(
        if phase == "forward" {
            cursor >= 0 && !matches!(status, "compensating" | "undoing" | "compensated")
        } else {
            cursor < count
                && !matches!(
                    status,
                    "ready" | "executing" | "awaiting-approval" | "completed"
                )
        },
        INVALID,
    )?;
    require(status != "completed" || cursor == count, INVALID)?;
    require(status != "compensated" || cursor == -1, INVALID)?;
    require(
        status != "awaiting-approval" || current.is_some_and(|s| s["kind"] == "approval"),
        INVALID,
    )?;
    let active = matches!(status, "executing" | "undoing" | "uncertain");
    require(v.get("active").is_some() == active, INVALID)?;
    if active {
        let a = &v["active"];
        keys(a, &["stepId", "direction", "effectKey"], &[])?;
        let step = current.ok_or(INVALID)?;
        require(
            step["kind"] == "action" && a["stepId"] == step["stepId"] && a["direction"] == phase,
            INVALID,
        )?;
        require(
            a["effectKey"]
                == format!(
                    "{}:{}:{}",
                    v["taskId"].as_str().ok_or(INVALID)?,
                    step["stepId"].as_str().ok_or(INVALID)?,
                    phase
                ),
            INVALID,
        )?;
        require(phase != "rollback" || step["compensate"] == true, INVALID)?;
    }
    require(v.get("code").is_some() == (status == "uncertain"), INVALID)?;
    if status == "uncertain" {
        require(
            matches!(
                v["code"].as_str(),
                Some("BLK-WORKFLOW-EFFECT" | "BLK-WORKFLOW-CANCELLED")
            ),
            INVALID,
        )?;
    }
    let resolutions = v["resolutions"]
        .as_array()
        .filter(|a| a.len() <= 128)
        .ok_or(INVALID)?;
    let mut last = 0;
    for item in resolutions {
        keys(item, &["revision", "stepId", "direction", "outcome"], &[])?;
        let rev = item["revision"]
            .as_u64()
            .filter(|r| *r > last && *r < revision)
            .ok_or(INVALID)?;
        last = rev;
        require(
            steps
                .iter()
                .any(|s| s["kind"] == "action" && s["stepId"] == item["stepId"])
                && matches!(item["direction"].as_str(), Some("forward" | "rollback"))
                && matches!(item["outcome"].as_str(), Some("completed" | "not-executed")),
            INVALID,
        )?;
    }
    Ok(v.clone())
}
pub fn create(task_id: &str, plan: &Value, state: Value) -> Result<Value, String> {
    definition(plan)?;
    parse(
        &json!({"schemaVersion":"blocky.workflow/v1","taskId":task_id,"definition":plan,"revision":1,
        "cursor":0,"forwardCursor":0,"phase":"forward","status":"ready","state":state,
        "receipts":plan["steps"].as_array().ok_or(INVALID)?.iter().map(|_|json!({"status":"pending"})).collect::<Vec<_>>(),"resolutions":[]}),
    )
}
pub fn summary(input: &Value) -> Result<Value, String> {
    let r = parse(input)?;
    let d = &r["definition"];
    let mut out = json!({"schemaVersion":"blocky.workflow-summary/v1","taskId":r["taskId"],
        "projectId":d["projectId"],"moduleId":d["moduleId"],"blockId":d["blockId"],"planDigest":d["planDigest"],
        "revision":r["revision"],"status":r["status"],"phase":r["phase"],"cursor":r["cursor"],"forwardCursor":r["forwardCursor"],
        "totalSteps":d["steps"].as_array().ok_or(INVALID)?.len(),"resolutions":r["resolutions"],
        "receipts":r["receipts"].as_array().ok_or(INVALID)?.iter().enumerate().map(|(i,r)|json!({"stepId":d["steps"][i]["stepId"],"status":r["status"]})).collect::<Vec<_>>()});
    if let Some(step) = r["cursor"]
        .as_u64()
        .and_then(|c| d["steps"].get(c as usize))
    {
        out["stepId"] = step["stepId"].clone();
    }
    for key in ["active", "code"] {
        if let Some(v) = r.get(key) {
            out[key] = v.clone();
        }
    }
    Ok(out)
}
