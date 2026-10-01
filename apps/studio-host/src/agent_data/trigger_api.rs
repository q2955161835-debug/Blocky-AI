//! Authorized native trigger operations and ephemeral authenticated event queues.
use super::*;
use std::{
    collections::VecDeque,
    sync::{
        Weak,
        atomic::{AtomicBool, Ordering},
    },
};
#[path = "trigger_session.rs"]
pub mod session;
fn present<'de, D: serde::Deserializer<'de>, T: Deserialize<'de>>(
    d: D,
) -> Result<Option<T>, D::Error> {
    T::deserialize(d).map(Some)
}
pub(super) struct Active {
    pub token: String,
    pub cancelled: Arc<AtomicBool>,
    pub _receiver: external_receiver::Receiver,
    project: String,
    session: String,
    trigger: String,
    revision: u64,
    queue: VecDeque<Value>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReceiverRequest {
    pub schema_version: String,
    pub request_id: String,
    pub project_id: String,
    pub session_id: String,
    pub action: String,
    #[serde(
        default,
        deserialize_with = "present",
        skip_serializing_if = "Option::is_none"
    )]
    pub trigger_id: Option<String>,
    #[serde(
        default,
        deserialize_with = "present",
        skip_serializing_if = "Option::is_none"
    )]
    pub expected_revision: Option<u64>,
    #[serde(
        default,
        deserialize_with = "present",
        skip_serializing_if = "Option::is_none"
    )]
    pub secret_ref: Option<String>,
    #[serde(
        default,
        deserialize_with = "present",
        skip_serializing_if = "Option::is_none"
    )]
    pub receiver_id: Option<String>,
}
impl ReceiverRequest {
    pub fn validate(&self) -> Result<(), String> {
        validate_context(&self.project_id, &self.session_id)?;
        let start = self.action == "start";
        if self.schema_version != "blocky.trigger-receiver-request/v1"
            || !stable(&self.request_id)
            || !matches!(self.action.as_str(), "start" | "poll" | "stop")
            || start != self.trigger_id.is_some()
            || start != self.expected_revision.is_some()
            || start != self.secret_ref.is_some()
            || start == self.receiver_id.is_some()
            || self.trigger_id.as_ref().is_some_and(|s| !stable(s))
            || self.secret_ref.as_ref().is_some_and(|s| !stable(s))
            || self.receiver_id.as_ref().is_some_and(|s| !stable(s))
            || self
                .expected_revision
                .is_some_and(|v| v == 0 || v > 9_007_199_254_740_991)
        {
            return Err(INVALID.into());
        }
        Ok(())
    }
    pub fn preflight(&self) -> Result<Value, String> {
        self.validate()?;
        Ok(
            json!({"requestDigest":digest(self)?,"projectId":self.project_id,"sessionId":self.session_id,"action":self.action,"triggerId":self.trigger_id,"expectedRevision":self.expected_revision,"receiverId":self.receiver_id,"secretRef":self.secret_ref}),
        )
    }
}
fn grant(state: &State, token: &str, project: &str, session: &str) -> Result<(), String> {
    state
        .grants
        .get(token)
        .filter(|g| {
            !state.closed
                && g.project == project
                && g.session == session
                && g.created.elapsed() < g.lifetime
        })
        .ok_or(PERMISSION)?;
    Ok(())
}
fn request(
    project: &str,
    session: &str,
    action: &str,
    fields: Value,
) -> Result<trigger_store::Request, String> {
    let mut v = json!({"schemaVersion":"blocky.trigger-request/v1","requestId":format!("trigger-{}",uuid::Uuid::new_v4()),"projectId":project,"sessionId":session,"action":action});
    for (k, value) in fields.as_object().ok_or(INVALID)? {
        v[k] = value.clone();
    }
    serde_json::from_value(v).map_err(|_| INVALID.into())
}
impl AgentData {
    fn trigger_root(&self) -> Result<PathBuf, String> {
        Ok(self.root.parent().ok_or(INVALID)?.join("agent-triggers"))
    }
    pub fn manage_trigger(&self, token: &str, r: &trigger_store::Request) -> Result<Value, String> {
        r.validate()?;
        if r.action == "claim" && r.occurrence.as_ref().is_some_and(|o| o.kind == "external") {
            return Err(PERMISSION.into());
        }
        let state = self.state.lock().map_err(|_| INVALID)?;
        grant(&state, token, &r.project_id, &r.session_id)?;
        if r.action == "complete" {
            let task = r
                .workflow_task_id
                .as_deref()
                .ok_or("BLK-TRIGGER-WORKFLOW-REQUIRED")?;
            let inventory = trigger_store::manage(
                &self.trigger_root()?,
                &request(&r.project_id, &r.session_id, "list", json!({}))?,
            )?;
            let occurrence = inventory["triggers"]
                .as_array()
                .ok_or(INVALID)?
                .iter()
                .filter(|t| t["config"]["triggerId"].as_str() == r.trigger_id.as_deref())
                .flat_map(|t| t["occurrences"].as_array().into_iter().flatten())
                .find(|o| o["occurrenceId"].as_str() == r.occurrence_id.as_deref())
                .ok_or("BLK-TRIGGER-BINDING")?;
            let workflow_root = self
                .root
                .parent()
                .and_then(|p| p.parent())
                .ok_or(INVALID)?
                .join("workflow");
            let record = crate::workflow::Store::new(workflow_root)
                .and_then(|s| s.read(task))
                .map_err(|_| "BLK-TRIGGER-WORKFLOW-BINDING")?;
            if record["definition"]["projectId"] != r.project_id
                || record["definition"]["moduleId"] != occurrence["moduleId"]
            {
                return Err("BLK-TRIGGER-WORKFLOW-BINDING".into());
            }
            let valid = match r.status.as_deref() {
                Some("completed") => record["status"] == "completed",
                Some("failed") => record["status"] == "compensated",
                _ => false,
            };
            if !valid {
                return Err("BLK-TRIGGER-WORKFLOW-UNSETTLED".into());
            }
        }
        trigger_store::manage(&self.trigger_root()?, r)
    }
    pub fn trigger_receiver(&self, token: &str, r: &ReceiverRequest) -> Result<Value, String> {
        r.validate()?;
        if r.action == "stop" {
            let active = {
                let mut state = self.state.lock().map_err(|_| INVALID)?;
                grant(&state, token, &r.project_id, &r.session_id)?;
                let id = r.receiver_id.as_ref().ok_or(INVALID)?;
                let a = state
                    .trigger_receivers
                    .get(id)
                    .ok_or("BLK-TRIGGER-RECEIVER-MISSING")?;
                if a.token != token || a.project != r.project_id || a.session != r.session_id {
                    return Err(PERMISSION.into());
                }
                a.cancelled.store(true, Ordering::Release);
                state.trigger_receivers.remove(id).ok_or(INVALID)?
            };
            drop(active);
            return Ok(json!({"receiverId":r.receiver_id,"active":false}));
        }
        let mut state = self.state.lock().map_err(|_| INVALID)?;
        grant(&state, token, &r.project_id, &r.session_id)?;
        if r.action == "poll" {
            let a = state
                .trigger_receivers
                .get_mut(r.receiver_id.as_ref().ok_or(INVALID)?)
                .ok_or("BLK-TRIGGER-RECEIVER-MISSING")?;
            if a.token != token || a.project != r.project_id || a.session != r.session_id {
                return Err(PERMISSION.into());
            }
            let config = trigger_store::manage(
                &self.trigger_root()?,
                &request(
                    &r.project_id,
                    &r.session_id,
                    "read",
                    json!({"triggerId":a.trigger}),
                )?,
            )?;
            let active = !a.cancelled.load(Ordering::Acquire)
                && config["enabled"] == true
                && config["revision"].as_u64() == Some(a.revision);
            if !active {
                a.cancelled.store(true, Ordering::Release);
                a.queue.clear();
            }
            let events: Vec<Value> = a.queue.drain(..).collect();
            return Ok(json!({"receiverId":r.receiver_id,"active":active,"events":events}));
        }
        if state.trigger_receivers.len() >= 16 {
            return Err("BLK-TRIGGER-RECEIVER-LIMIT".into());
        }
        let config = trigger_store::manage(
            &self.trigger_root()?,
            &request(
                &r.project_id,
                &r.session_id,
                "read",
                json!({"triggerId":r.trigger_id}),
            )?,
        )?;
        let config: trigger_store::Config =
            serde_json::from_value(config).map_err(|_| "BLK-TRIGGER-BINDING")?;
        if !config.enabled
            || config.trigger_type != "external"
            || config.revision != r.expected_revision.ok_or(INVALID)?
        {
            return Err("BLK-TRIGGER-BINDING".into());
        }
        let source = config.source_id.ok_or(INVALID)?;
        let receiver_id = format!("receiver-{}", uuid::Uuid::new_v4());
        let cancelled = Arc::new(AtomicBool::new(false));
        let weak = Arc::downgrade(&self.state);
        let own = token.to_string();
        let project = r.project_id.clone();
        let session = r.session_id.clone();
        let trigger = config.trigger_id;
        let revision = config.revision;
        let active_id = receiver_id.clone();
        let alive_cancel = cancelled.clone();
        let alive_weak = weak.clone();
        let alive_token = own.clone();
        let alive_project = project.clone();
        let alive_session = session.clone();
        let root = self.trigger_root()?;
        let alive_root = root.clone();
        let alive_trigger = trigger.clone();
        let checked = Mutex::new(Instant::now() - Duration::from_secs(1));
        let alive = Arc::new(move || {
            if alive_cancel.load(Ordering::Acquire) {
                return false;
            }
            let Some(state) = alive_weak.upgrade() else {
                return false;
            };
            let Ok(state) = state.lock() else {
                return false;
            };
            if grant(&state, &alive_token, &alive_project, &alive_session).is_err() {
                return false;
            }
            let Ok(mut checked) = checked.lock() else {
                return false;
            };
            if checked.elapsed() >= Duration::from_millis(250) {
                *checked = Instant::now();
                let valid = request(
                    &alive_project,
                    &alive_session,
                    "read",
                    json!({"triggerId":alive_trigger}),
                )
                .and_then(|r| trigger_store::manage(&alive_root, &r))
                .is_ok_and(|c| c["enabled"] == true && c["revision"].as_u64() == Some(revision));
                if !valid {
                    alive_cancel.store(true, Ordering::Release);
                    return false;
                }
            }
            true
        });
        let consume_cancel = cancelled.clone();
        let consume_trigger = trigger.clone();
        let consume_project = project.clone();
        let consume_session = session.clone();
        let consume_token = own.clone();
        let consume = Arc::new(move |event: external_receiver::Event| {
            consume_event(
                &weak,
                &root,
                &active_id,
                &consume_token,
                &consume_project,
                &consume_session,
                &consume_trigger,
                revision,
                &consume_cancel,
                event,
            )
        });
        let secrets = self
            .root
            .parent()
            .and_then(|p| p.parent())
            .ok_or(INVALID)?
            .join("secrets");
        let receiver = external_receiver::Receiver::start(
            secrets,
            r.secret_ref.clone().ok_or(INVALID)?,
            project.clone(),
            source,
            consume,
            alive,
        )?;
        let endpoint = receiver.endpoint.clone();
        state.trigger_receivers.insert(
            receiver_id.clone(),
            Active {
                token: own,
                cancelled,
                _receiver: receiver,
                project,
                session,
                trigger,
                revision,
                queue: VecDeque::new(),
            },
        );
        Ok(json!({"receiverId":receiver_id,"endpoint":endpoint,"configRevision":revision}))
    }
}
#[allow(clippy::too_many_arguments)]
fn consume_event(
    weak: &Weak<Mutex<State>>,
    root: &std::path::Path,
    receiver_id: &str,
    token: &str,
    project: &str,
    session: &str,
    trigger: &str,
    revision: u64,
    cancelled: &AtomicBool,
    event: external_receiver::Event,
) -> Result<Value, String> {
    let state = weak.upgrade().ok_or(PERMISSION)?;
    let mut state = state.lock().map_err(|_| INVALID)?;
    grant(&state, token, project, session)?;
    if cancelled.load(Ordering::Acquire) {
        return Err(PERMISSION.into());
    }
    let config = trigger_store::manage(
        root,
        &request(project, session, "read", json!({"triggerId":trigger}))?,
    )?;
    if config["revision"].as_u64() != Some(revision) || config["enabled"] != true {
        cancelled.store(true, Ordering::Release);
        return Err("BLK-TRIGGER-BINDING".into());
    }
    if event.trigger_id != trigger
        || event.revision != revision
        || config["sourceId"] != event.source_id
    {
        return Err("BLK-TRIGGER-BINDING".into());
    }
    if state
        .trigger_receivers
        .values()
        .map(|a| a.queue.len())
        .sum::<usize>()
        >= 128
    {
        return Err("BLK-TRIGGER-QUEUE-LIMIT".into());
    }
    if !state.trigger_receivers.contains_key(receiver_id) {
        return Err(PERMISSION.into());
    }
    let occurrence = json!({"occurrenceId":format!("{project}:{trigger}:r{revision}:external:{}",event.event_id),"scheduledAt":event.occurred_at,"kind":"external","eventId":event.event_id});
    let outcome = trigger_store::manage(
        root,
        &request(
            project,
            session,
            "claim",
            json!({"triggerId":trigger,"expectedRevision":revision,"occurrence":occurrence}),
        )?,
    )?;
    if outcome["claimed"] == true {
        state
            .trigger_receivers
            .get_mut(receiver_id)
            .ok_or(PERMISSION)?
            .queue
            .push_back(json!({"occurrence":outcome["record"],"payload":event.payload}));
    }
    Ok(json!({"claimed":outcome["claimed"],"queued":outcome["claimed"]==true}))
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    use std::{
        io::{Read, Write},
        net::TcpStream,
    };
    fn setup() -> (tempfile::TempDir, AgentData, String) {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../try/agent-capability-upgrade/trigger-api-tests");
        std::fs::create_dir_all(&root).unwrap();
        let tmp = tempfile::tempdir_in(std::path::absolute(root).unwrap()).unwrap();
        let env = tmp.path().join("synthetic.env");
        std::fs::write(&env, "KEY=synthetic-receiver-token\n").unwrap();
        crate::secret_store::SecretStore::new(tmp.path().join("secrets"))
            .import_env("receiver-test", &env, "KEY")
            .unwrap();
        std::fs::remove_file(env).unwrap();
        let host = AgentData::new(tmp.path().join("user/agent-memory"));
        let token = host.authorize("project-one", "session-one").unwrap();
        let r:trigger_store::Request=serde_json::from_value(json!({"schemaVersion":"blocky.trigger-request/v1","requestId":"config-one","projectId":"project-one","sessionId":"session-one","action":"upsert","expectedRevision":null,"config":{"schemaVersion":"blocky.trigger/v1","projectId":"project-one","triggerId":"trigger-one","moduleId":"module-one","exportId":"export-one","revision":1,"enabled":true,"type":"external","sourceId":"source-one"}})).unwrap();
        host.manage_trigger(&token, &r).unwrap();
        (tmp, host, token)
    }
    fn receiver_request(action: &str, id: Option<&str>) -> ReceiverRequest {
        let mut v = json!({"schemaVersion":"blocky.trigger-receiver-request/v1","requestId":"receiver-operation","projectId":"project-one","sessionId":"session-one","action":action});
        if action == "start" {
            v["triggerId"] = json!("trigger-one");
            v["expectedRevision"] = json!(1);
            v["secretRef"] = json!("receiver-test");
        } else {
            v["receiverId"] = json!(id.unwrap());
        }
        serde_json::from_value(v).unwrap()
    }
    fn event(host: &AgentData, id: &str, endpoint: &str, event_id: &str) -> Value {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;
        let body=serde_json::to_vec(&json!({"schemaVersion":"blocky.external-trigger-event/v1","projectId":"project-one","triggerId":"trigger-one","sourceId":"source-one","revision":1,"eventId":event_id,"occurredAt":now,"payload":{"canary":"private-event-body"}})).unwrap();
        let mut stream = TcpStream::connect(
            endpoint
                .trim_start_matches("http://")
                .trim_end_matches("/events"),
        )
        .unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(2)))
            .unwrap();
        stream.write_all(format!("POST /events HTTP/1.1\r\nAuthorization: Bearer synthetic-receiver-token\r\nContent-Length: {}\r\n\r\n",body.len()).as_bytes()).unwrap();
        stream.write_all(&body).unwrap();
        let mut response = String::new();
        stream.read_to_string(&mut response).unwrap();
        assert!(!response.contains("private-event-body"));
        assert!(
            host.state
                .lock()
                .unwrap()
                .trigger_receivers
                .contains_key(id)
        );
        serde_json::from_str(response.split_once("\r\n\r\n").unwrap().1).unwrap()
    }
    #[test]
    fn authenticated_claim_precedes_ephemeral_queue_and_duplicates() {
        let (tmp, host, token) = setup();
        let started = host
            .trigger_receiver(&token, &receiver_request("start", None))
            .unwrap();
        let id = started["receiverId"].as_str().unwrap();
        let endpoint = started["endpoint"].as_str().unwrap();
        assert_eq!(event(&host, id, endpoint, "event-one")["duplicate"], false);
        assert_eq!(event(&host, id, endpoint, "event-one")["duplicate"], true);
        let persisted = host
            .manage_trigger(
                &token,
                &request("project-one", "session-one", "list", json!({})).unwrap(),
            )
            .unwrap();
        assert_eq!(
            persisted["triggers"][0]["occurrences"][0]["status"],
            "claimed"
        );
        assert!(!persisted.to_string().contains("private-event-body"));
        let poll = host
            .trigger_receiver(&token, &receiver_request("poll", Some(id)))
            .unwrap();
        assert_eq!(poll["events"].as_array().unwrap().len(), 1);
        assert_eq!(poll["events"][0]["payload"]["canary"], "private-event-body");
        assert_eq!(poll["events"][0]["occurrence"]["moduleId"], "module-one");
        assert_eq!(
            host.trigger_receiver(&token, &receiver_request("poll", Some(id)))
                .unwrap()["events"],
            json!([])
        );
        host.trigger_receiver(&token, &receiver_request("stop", Some(id)))
            .unwrap();
        assert!(
            TcpStream::connect(
                endpoint
                    .trim_start_matches("http://")
                    .trim_end_matches("/events")
            )
            .is_err()
        );
        host.shutdown().unwrap();
        drop(tmp);
    }
    #[test]
    fn grant_revoke_close_and_config_revision_release_ports() {
        let (_tmp, host, token) = setup();
        let started = host
            .trigger_receiver(&token, &receiver_request("start", None))
            .unwrap();
        let endpoint = started["endpoint"].as_str().unwrap();
        host.revoke(&token).unwrap();
        assert!(
            TcpStream::connect(
                endpoint
                    .trim_start_matches("http://")
                    .trim_end_matches("/events")
            )
            .is_err()
        );
        let token = host.authorize("project-one", "session-one").unwrap();
        let started = host
            .trigger_receiver(&token, &receiver_request("start", None))
            .unwrap();
        let id = started["receiverId"].as_str().unwrap();
        let endpoint = started["endpoint"].as_str().unwrap();
        let pause = request(
            "project-one",
            "session-one",
            "pause",
            json!({"triggerId":"trigger-one","expectedRevision":1,"paused":true}),
        )
        .unwrap();
        host.manage_trigger(&token, &pause).unwrap();
        std::thread::sleep(Duration::from_millis(350));
        assert!(
            TcpStream::connect(
                endpoint
                    .trim_start_matches("http://")
                    .trim_end_matches("/events")
            )
            .is_err()
        );
        assert_eq!(
            host.trigger_receiver(&token, &receiver_request("poll", Some(id)))
                .unwrap()["active"],
            false
        );
        host.shutdown().unwrap();
    }
    #[test]
    fn external_direct_claim_binding_and_queue_limit_fail_closed() {
        let (_tmp, host, token) = setup();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;
        let claim=request("project-one","session-one","claim",json!({"triggerId":"trigger-one","expectedRevision":1,"occurrence":{"occurrenceId":"project-one:trigger-one:r1:external:event-one","scheduledAt":now,"kind":"external","eventId":"event-one"}})).unwrap();
        assert_eq!(host.manage_trigger(&token, &claim).unwrap_err(), PERMISSION);
        let mut r = receiver_request("start", None);
        r.project_id = "project-other".into();
        assert_eq!(host.trigger_receiver(&token, &r).unwrap_err(), PERMISSION);
        let started = host
            .trigger_receiver(&token, &receiver_request("start", None))
            .unwrap();
        let id = started["receiverId"].as_str().unwrap();
        {
            let mut state = host.state.lock().unwrap();
            state.trigger_receivers.get_mut(id).unwrap().queue =
                std::iter::repeat_n(json!({}), 128).collect();
        }
        let e:external_receiver::Event=serde_json::from_value(json!({"schemaVersion":"blocky.external-trigger-event/v1","projectId":"project-one","triggerId":"trigger-one","sourceId":"source-one","revision":1,"eventId":"event-overflow","occurredAt":now,"payload":{}})).unwrap();
        let cancel = Arc::new(AtomicBool::new(false));
        let mut stale = e.clone();
        stale.revision = 2;
        assert_eq!(
            consume_event(
                &Arc::downgrade(&host.state),
                &host.trigger_root().unwrap(),
                id,
                &token,
                "project-one",
                "session-one",
                "trigger-one",
                1,
                &cancel,
                stale
            )
            .unwrap_err(),
            "BLK-TRIGGER-BINDING"
        );
        assert!(!cancel.load(Ordering::Acquire));
        assert_eq!(
            consume_event(
                &Arc::downgrade(&host.state),
                &host.trigger_root().unwrap(),
                id,
                &token,
                "project-one",
                "session-one",
                "trigger-one",
                1,
                &cancel,
                e
            )
            .unwrap_err(),
            "BLK-TRIGGER-QUEUE-LIMIT"
        );
        assert_eq!(
            host.manage_trigger(
                &token,
                &request("project-one", "session-one", "list", json!({})).unwrap()
            )
            .unwrap()["triggers"][0]["occurrences"],
            json!([])
        );
        let poll = host
            .trigger_receiver(&token, &receiver_request("poll", Some(id)))
            .unwrap();
        assert_eq!(poll["events"].as_array().unwrap().len(), 128);
        assert_eq!(
            host.state
                .lock()
                .unwrap()
                .trigger_receivers
                .get(id)
                .unwrap()
                .queue
                .len(),
            0
        );
        host.shutdown().unwrap();
    }
    #[test]
    fn last_owner_drop_releases_listener() {
        let (_tmp, host, token) = setup();
        let started = host
            .trigger_receiver(&token, &receiver_request("start", None))
            .unwrap();
        let address = started["endpoint"]
            .as_str()
            .unwrap()
            .trim_start_matches("http://")
            .trim_end_matches("/events")
            .to_string();
        drop(host);
        let deadline = Instant::now() + Duration::from_secs(1);
        while TcpStream::connect(&address).is_ok() && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(20));
        }
        assert!(TcpStream::connect(address).is_err());
    }
    #[test]
    fn complete_requires_actual_bound_terminal_workflow() {
        let (tmp, host, token) = setup();
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;
        for event in ["event-complete", "event-failed"] {
            let r=request("project-one","session-one","claim",json!({"triggerId":"trigger-one","expectedRevision":1,"occurrence":{"occurrenceId":format!("project-one:trigger-one:r1:external:{event}"),"scheduledAt":timestamp,"kind":"external","eventId":event}})).unwrap();
            let _guard = host.state.lock().unwrap();
            trigger_store::manage(&host.trigger_root().unwrap(), &r).unwrap();
        }
        let mut complete=request("project-one","session-one","complete",json!({"triggerId":"trigger-one","occurrenceId":"project-one:trigger-one:r1:external:event-complete","claimRevision":1,"status":"completed"})).unwrap();
        assert_eq!(
            host.manage_trigger(&token, &complete).unwrap_err(),
            "BLK-TRIGGER-WORKFLOW-REQUIRED"
        );
        let store = crate::workflow::Store::new(tmp.path().join("workflow")).unwrap();
        let definition = json!({"projectId":"project-one","moduleId":"module-one","blockId":"workflow-one","planDigest":"a".repeat(64),"runtimeVersion":1,"steps":[{"stepId":"action-one","kind":"action","compensate":true}]});
        let mut wrong = definition.clone();
        complete.workflow_task_id = Some("task-missing".into());
        assert_eq!(
            host.manage_trigger(&token, &complete).unwrap_err(),
            "BLK-TRIGGER-WORKFLOW-BINDING"
        );
        wrong["projectId"] = json!("project-other");
        store
            .create("task-project-wrong", &wrong, Value::Null)
            .unwrap();
        complete.workflow_task_id = Some("task-project-wrong".into());
        assert_eq!(
            host.manage_trigger(&token, &complete).unwrap_err(),
            "BLK-TRIGGER-WORKFLOW-BINDING"
        );
        wrong = definition.clone();
        wrong["moduleId"] = json!("module-other");
        store.create("task-wrong", &wrong, Value::Null).unwrap();
        complete.workflow_task_id = Some("task-wrong".into());
        assert_eq!(
            host.manage_trigger(&token, &complete).unwrap_err(),
            "BLK-TRIGGER-WORKFLOW-BINDING"
        );
        store
            .create("task-complete", &definition, Value::Null)
            .unwrap();
        complete.workflow_task_id = Some("task-complete".into());
        assert_eq!(
            host.manage_trigger(&token, &complete).unwrap_err(),
            "BLK-TRIGGER-WORKFLOW-UNSETTLED"
        );
        let mut lease = store.acquire("task-complete", &definition, 1).unwrap();
        lease.commit(&json!({"kind":"begin","revision":1})).unwrap();
        assert_eq!(
            host.manage_trigger(&token, &complete).unwrap_err(),
            "BLK-TRIGGER-WORKFLOW-UNSETTLED"
        );
        lease
            .commit(&json!({"kind":"complete","revision":2,"state":null}))
            .unwrap();
        lease
            .commit(&json!({"kind":"finish","revision":3}))
            .unwrap();
        lease.release().unwrap();
        assert_eq!(
            host.manage_trigger(&token, &complete).unwrap()["record"]["status"],
            "completed"
        );
        let failed=request("project-one","session-one","complete",json!({"triggerId":"trigger-one","occurrenceId":"project-one:trigger-one:r1:external:event-failed","claimRevision":1,"status":"failed","stableErrorCode":"BLK-TRIGGER-FAILED","workflowTaskId":"task-failed"})).unwrap();
        store
            .create("task-failed", &definition, Value::Null)
            .unwrap();
        assert_eq!(
            host.manage_trigger(&token, &failed).unwrap_err(),
            "BLK-TRIGGER-WORKFLOW-UNSETTLED"
        );
        let mut lease = store.acquire("task-failed", &definition, 1).unwrap();
        lease
            .commit(&json!({"kind":"rollback","revision":1}))
            .unwrap();
        lease
            .commit(&json!({"kind":"finish","revision":2}))
            .unwrap();
        lease.release().unwrap();
        assert_eq!(
            host.manage_trigger(&token, &failed).unwrap()["record"]["status"],
            "failed"
        );
        host.shutdown().unwrap();
    }
}
