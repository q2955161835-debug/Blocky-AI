use super::desktop::RuntimeHost;
use serde_json::{Value, json};
use std::sync::atomic::{AtomicUsize, Ordering};
fn request(question: &str) -> Value {
    json!({"schemaVersion":"blocky.desktop-run/v1", "project":serde_json::from_str::<Value>(include_str!("../../../../tests/host/fixtures/desktop-runtime-project.json")).unwrap(), "interactionId":"on-event", "question":question, "options":{}})
}
fn directory() -> tempfile::TempDir {
    tempfile::tempdir_in(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .parent()
            .unwrap()
            .join("try"),
    )
    .unwrap()
}
#[test]
fn desktop_native_runtime_preserves_private_state_and_requires_service_settlement() {
    let dir = directory();
    let host = RuntimeHost::new(dir.path().join("workflow"));
    let token = host.open().unwrap();
    let mut sequence = 0;
    for (input, expected) in [("start", "running"), ("finish", "done")] {
        let run = format!("run-{input}");
        let events = AtomicUsize::new(0);
        let result = host
            .run(&token, &run, request(input), |frame| {
                assert!(frame.get("state").is_none());
                match frame["kind"].as_str().unwrap() {
                    "ready" => {}
                    "event" => {
                        events.fetch_add(1, Ordering::SeqCst);
                    }
                    "service" => {
                        assert_eq!(frame["request"]["service"], "agent.close");
                        host.request(
                            &token,
                            &run,
                            json!({"kind":"reply","id":frame["id"],"ok":true,"value":null}),
                        )?;
                    }
                    "settle" => host.request(&token, &run, json!({"kind":"settled","ok":true}))?,
                    _ => panic!("unexpected frame"),
                }
                Ok(())
            })
            .unwrap();
        assert_eq!(result["status"], "completed");
        assert_eq!(result["structured"], expected);
        assert!(result.get("state").is_none());
        assert!(events.load(Ordering::SeqCst) > 2);
        let first = result["events"][0]["sequence"].as_u64().unwrap();
        assert!(first > sequence);
        sequence = result["events"].as_array().unwrap().last().unwrap()["sequence"]
            .as_u64()
            .unwrap();
    }
    assert!(
        host.request(&token, "run-start", json!({"kind":"cancel"}))
            .is_err()
    );
    host.close(&token).unwrap();
    host.shutdown().unwrap();
    assert!(host.open().is_err());
}
#[test]
fn desktop_rejects_imported_state_and_poisoned_session_cannot_silently_restart() {
    let dir = directory();
    let host = RuntimeHost::new(dir.path().join("workflow"));
    let token = host.open().unwrap();
    let mut initial = request("start");
    initial["state"] = json!("injected");
    assert!(
        host.run(&token, "injected", initial, |_| panic!(
            "must reject before launch"
        ))
        .is_err()
    );
    let result = host.run(&token, "run-fail", request("start"), |frame| {
        match frame["kind"].as_str().unwrap() {
            "service" => host.request(
                &token,
                "run-fail",
                json!({"kind":"reply","id":frame["id"],"ok":true,"value":null}),
            )?,
            "settle" => host.request(&token, "run-fail", json!({"kind":"settled","ok":false}))?,
            "event" | "ready" => {}
            _ => panic!(),
        }
        Ok(())
    });
    assert_eq!(result.unwrap_err(), "BLK-RUN-SERVICE");
    assert!(
        host.run(&token, "retry", request("finish"), |_| panic!())
            .is_err()
    );
    host.close(&token).unwrap();
    assert_ne!(host.open().unwrap(), token);
}

#[test]
fn desktop_native_debug_and_cancel_are_bound_to_current_run() {
    let dir = directory();
    let host = RuntimeHost::new(dir.path().join("workflow"));
    let token = host.open().unwrap();
    let paused = AtomicUsize::new(0);
    let result = host
        .run(&token, "debug-run", request("start"), |frame| {
            match frame["kind"].as_str().unwrap() {
                "ready" => {
                    assert!(host.open().is_err());
                    assert!(
                        host.request("other-session", "debug-run", json!({"kind":"cancel"}))
                            .is_err()
                    );
                    assert!(
                        host.request(&token, "other-run", json!({"kind":"cancel"}))
                            .is_err()
                    );
                    host.request(
                        &token,
                        "debug-run",
                        json!({"kind":"control","action":"pause"}),
                    )?;
                }
                "event" if frame["value"]["type"] == "run.paused" => {
                    let action = if paused.fetch_add(1, Ordering::SeqCst) == 0 {
                        "step"
                    } else {
                        "resume"
                    };
                    host.request(
                        &token,
                        "debug-run",
                        json!({"kind":"control","action":action}),
                    )?;
                }
                "event" => {}
                "service" => host.request(
                    &token,
                    "debug-run",
                    json!({"kind":"reply","id":frame["id"],"ok":true,"value":null}),
                )?,
                "settle" => {
                    host.request(&token, "debug-run", json!({"kind":"settled","ok":true}))?
                }
                _ => panic!(),
            }
            Ok(())
        })
        .unwrap();
    assert_eq!(result["status"], "completed");
    assert!(paused.load(Ordering::SeqCst) >= 2);
    let result = host
        .run(&token, "cancel-run", request("finish"), |frame| {
            match frame["kind"].as_str().unwrap() {
                "ready" => host.request(&token, "cancel-run", json!({"kind":"cancel"}))?,
                "event" => {}
                "service" => host.request(
                    &token,
                    "cancel-run",
                    json!({"kind":"reply","id":frame["id"],"ok":true,"value":null}),
                )?,
                "settle" => {
                    host.request(&token, "cancel-run", json!({"kind":"settled","ok":true}))?
                }
                _ => panic!(),
            }
            Ok(())
        })
        .unwrap();
    assert_eq!(result["status"], "cancelled");
    host.close(&token).unwrap();
}

#[test]
fn desktop_workflow_keeps_lease_until_services_settle_then_releases_for_approval() {
    let dir = directory();
    let root = dir.path().join("workflow");
    let host = RuntimeHost::new(root.clone());
    let token = host.open().unwrap();
    let project: Value = serde_json::from_str(include_str!(
        "../../../../tests/host/fixtures/desktop-workflow-project.json"
    ))
    .unwrap();
    let request = json!({"schemaVersion":"blocky.desktop-run/v1","interactionId":project["workspaces"]["main"]["blocks"]["blocks"][0]["id"],"project":project,"question":"approval fixture","options":{}});
    let result = host
        .run(&token, "workflow-run", request, |frame| {
            match frame["kind"].as_str().unwrap() {
                "ready" | "event" => {}
                "service" => {
                    assert_eq!(frame["request"]["service"], "agent.close");
                    host.request(
                        &token,
                        "workflow-run",
                        json!({"kind":"reply","id":frame["id"],"ok":true,"value":null}),
                    )?;
                }
                "settle" => {
                    host.request(&token, "workflow-run", json!({"kind":"settled","ok":true}))?
                }
                _ => panic!(),
            }
            Ok(())
        })
        .unwrap();
    assert_eq!(result["status"], "waiting");
    let id = result["workflow"]["taskId"].as_str().unwrap();
    let store = super::Store::new(root).unwrap();
    let record = store.read(id).unwrap();
    assert_eq!(record["status"], "awaiting-approval");
    assert!(store.execution(id).unwrap().is_none()); // successful release retires its execution binding
    // A fresh native owner may acquire only after the run and service barrier returned.
    store
        .acquire(
            id,
            &record["definition"],
            record["revision"].as_u64().unwrap(),
        )
        .unwrap()
        .release()
        .unwrap();
    host.close(&token).unwrap();
}

#[test]
fn desktop_missing_service_settlement_does_not_publish_a_reusable_execution_proof() {
    let dir = directory();
    let root = dir.path().join("workflow");
    let host = RuntimeHost::new(root.clone());
    let token = host.open().unwrap();
    let project: Value = serde_json::from_str(include_str!(
        "../../../../tests/host/fixtures/desktop-workflow-project.json"
    ))
    .unwrap();
    let project_id = project["manifest"]["projectId"]
        .as_str()
        .unwrap()
        .to_owned();
    let store = super::Store::new(root).unwrap();
    let request = json!({"schemaVersion":"blocky.desktop-run/v1","interactionId":"on-event","project":project,"question":"approval fixture","options":{}});
    let outcome = host.run(&token, "unsettled-run", request, |frame| {
        match frame["kind"].as_str().unwrap() {
            "ready" | "event" => {}
            "service" => host.request(
                &token,
                "unsettled-run",
                json!({"kind":"reply","id":frame["id"],"ok":true,"value":null}),
            )?,
            "settle" => {
                let list = store.summaries(&project_id)?;
                let id = list[0]["taskId"].as_str().unwrap();
                let record = store.read(id)?;
                assert!(
                    store
                        .acquire(
                            id,
                            &record["definition"],
                            record["revision"].as_u64().unwrap()
                        )
                        .is_err()
                );
                host.request(
                    &token,
                    "unsettled-run",
                    json!({"kind":"settled","ok":false}),
                )?;
            }
            _ => panic!(),
        }
        Ok(())
    });
    assert_eq!(outcome.unwrap_err(), "BLK-RUN-SERVICE");
    let list = store.summaries(&project_id).unwrap();
    let id = list[0]["taskId"].as_str().unwrap();
    assert!(!store.execution(id).unwrap().unwrap().settled());
    host.close(&token).unwrap();
}

#[test]
fn desktop_budget_cancellation_reaches_service_owner_before_worker_settlement() {
    let dir = directory();
    let host = RuntimeHost::new(dir.path().join("workflow"));
    let token = host.open().unwrap();
    let pending = AtomicUsize::new(0);
    let cancelled = AtomicUsize::new(0);
    let project: Value = serde_json::from_str(include_str!("../../../../tests/host/fixtures/desktop-rpa-budget-project.json")).unwrap();
    let initial = json!({"schemaVersion":"blocky.desktop-run/v1","interactionId":"on-rpa-budget","project":project,"question":"owned","options":{}});
    let result = host.run(&token, "budget-run", initial, |frame| {
        match frame["kind"].as_str().unwrap() {
            "ready" | "event" => {},
            "service" => {
                let id = frame["id"].as_u64().unwrap();
                match frame["request"]["service"].as_str().unwrap() {
                    "rpa.perform" => { pending.store(id as usize, Ordering::SeqCst); },
                    service => {
                        let value = if service == "rpa.open" { json!({"handle":"rpa-owned","checkpointId":"checkpoint-owned"}) }
                            else { assert!(matches!(service,"rpa.close"|"agent.close")); Value::Null };
                        host.request(&token,"budget-run",json!({"kind":"reply","id":id,"ok":true,"value":value}))?;
                    }
                }
            },
            "cancel" => {
                cancelled.fetch_add(1, Ordering::SeqCst);
                let id = pending.swap(0, Ordering::SeqCst);
                assert!(id > 0);
                host.request(&token,"budget-run",json!({"kind":"reply","id":id,"ok":false,"value":{"code":"BLK-RUN-SERVICE"}}))?;
            },
            "settle" => host.request(&token,"budget-run",json!({"kind":"settled","ok":true}))?,
            _ => panic!("unexpected frame"),
        }
        Ok(())
    }).unwrap();
    assert_eq!(cancelled.load(Ordering::SeqCst),1);
    assert_eq!(result["status"],"failed");
    assert_eq!(result["events"].as_array().unwrap().last().unwrap()["data"]["code"],"BLK-RUN-007");
    // A settled budget failure retains a usable native connection.
    assert!(host.run(&token,"next-run",request("start"),|frame| {
        match frame["kind"].as_str().unwrap() {
            "ready" | "event" => {},
            "service" => host.request(&token,"next-run",json!({"kind":"reply","id":frame["id"],"ok":true,"value":null}))?,
            "settle" => host.request(&token,"next-run",json!({"kind":"settled","ok":true}))?,
            _=>panic!("unexpected frame"),
        }
        Ok(())
    }).is_ok());
    host.close(&token).unwrap();
}
