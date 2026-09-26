pub mod journal;
#[cfg(test)]
mod native_tests;
mod owner;
mod process;
pub mod protocol;
pub mod recovery;
mod runner;
pub mod target;
#[cfg(test)]
mod tests;
mod worker;
pub use runner::main as runner_main;
pub use worker::main as worker_main;

use protocol::{Action, Locator, Plan};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    sync::{
        Arc, Condvar, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Receipt {
    pub step_id: String,
    pub effect_key: String,
    pub target_identity: String,
    pub status: String,
    pub verified: bool,
}
struct Session {
    checkpoint_id: Option<String>,
    checkpoint_revision: u64,
    plan: Plan,
    target: target::Target,
    root_id: Vec<i32>,
    expires: u64,
    status: &'static str,
    next: usize,
    active: bool,
    receipts: Vec<Receipt>,
    cancel: Arc<AtomicBool>,
}
struct Slot {
    state: Mutex<Session>,
    settled: Condvar,
}
struct Approval {
    cancel: Arc<AtomicBool>,
    active: AtomicBool,
    unsettled: AtomicBool,
    grant: Mutex<Option<String>>,
    expires: u64,
}
#[derive(Default)]
pub struct RpaHost {
    journal: Option<journal::Store>,
    sessions: Mutex<HashMap<String, Arc<Slot>>>,
    approvals: Mutex<HashMap<String, Arc<Approval>>>,
    closing: AtomicBool,
}
pub struct Prepared {
    plan: Plan,
    target: target::Target,
    root_id: Vec<i32>,
    pub preview: Value,
}
pub fn preflight(plan: Plan) -> Result<Prepared, String> {
    preflight_with_cancel(plan, Arc::new(AtomicBool::new(false)))
}
fn preflight_with_cancel(plan: Plan, cancel: Arc<AtomicBool>) -> Result<Prepared, String> {
    plan.validate()?;
    // Provider credentials in SecretStore have no RPA-purpose grant. Do not let
    // a plan turn their references into text in an arbitrary application.
    if plan
        .steps
        .iter()
        .any(|s| s.value.as_ref().is_some_and(|v| v.kind == "secret-ref"))
    {
        return Err("BLK-RPA-SENSITIVE-001".into());
    }
    if plan.target.kind != "windows"
        || plan
            .steps
            .iter()
            .any(|s| !matches!(s.locator, Locator::Uia { .. }) || s.action == Action::Screenshot)
    {
        return Err("BLK-RPA-UNSUPPORTED-001".into());
    }
    let target = target::list()
        .into_iter()
        .find(|t| t.identity == plan.target.identity)
        .ok_or("BLK-RPA-TARGET-001")?;
    let value = process::run(
        &worker::Input {
            target: target.clone(),
            root_id: None,
            step: None,
            input: None,
            approval: None,
        },
        5000,
        cancel,
    )?;
    let root_id: Vec<i32> =
        serde_json::from_value(value["rootId"].clone()).map_err(|_| "BLK-RPA-TARGET-001")?;
    if root_id.is_empty() || root_id.len() > 64 {
        return Err("BLK-RPA-TARGET-001".into());
    }
    let digest = format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(&plan).map_err(|_| "BLK-RPA-PLAN-001")?)
    );
    let preview = json!({"planId":plan.plan_id,"target":target,"steps":plan.steps,"digest":digest,"expiresInMs":600000,"sensitiveInput":"password-controls-denied","scope":"same-user-non-elevated-window"});
    Ok(Prepared {
        plan,
        target,
        root_id,
        preview,
    })
}
impl RpaHost {
    pub fn with_journal(root: std::path::PathBuf) -> Self {
        Self {
            journal: Some(journal::Store::new(root)),
            ..Self::default()
        }
    }
    fn persist(&self, session: &mut Session) -> Result<(), String> {
        let (Some(store), Some(id)) = (&self.journal, &session.checkpoint_id) else {
            return Ok(());
        };
        let snapshot = journal::Snapshot {
            schema_version: "blocky.rpa-journal/v1".into(),
            owner: Some(owner::Owner::current()?),
            checkpoint_id: id.clone(),
            revision: session.checkpoint_revision,
            plan_digest: crate::agent_data::digest(&session.plan)?,
            plan: session.plan.clone(),
            target: session.target.clone(),
            root_id: session.root_id.clone(),
            next: session.next,
            status: session.status.into(),
            receipts: session.receipts.clone(),
            updated_at_ms: now(),
        };
        session.checkpoint_revision = store.save(snapshot, session.checkpoint_revision)?;
        Ok(())
    }
    pub fn authorize_attended(&self, request_id: &str, plan: Plan) -> Result<Value, String> {
        self.authorize_request(request_id, plan, None)
    }
    fn authorize_request(
        &self,
        request_id: &str,
        plan: Plan,
        recovery: Option<recovery::Request>,
    ) -> Result<Value, String> {
        if !crate::project_store::stable(request_id) || request_id.len() > 200 {
            return Err("BLK-RPA-PLAN-001".into());
        }
        let approval = {
            let mut pending = self.approvals.lock().map_err(|_| "BLK-RPA-STATE-001")?;
            if self.closing.load(Ordering::SeqCst) {
                return Err("BLK-RPA-STATE-001".into());
            }
            pending.retain(|_, item| {
                item.active.load(Ordering::SeqCst)
                    || item.unsettled.load(Ordering::SeqCst)
                    || item.expires > now()
            });
            if let Some(previous) = pending.get(request_id) {
                if previous.cancel.load(Ordering::SeqCst) {
                    return Err("BLK-RPA-CANCELLED".into());
                }
                return Err("BLK-RPA-STATE-001".into());
            }
            if pending.len() >= 16 {
                return Err("BLK-RPA-LIMIT-001".into());
            }
            let value = Arc::new(Approval {
                cancel: Arc::new(AtomicBool::new(false)),
                active: AtomicBool::new(true),
                unsettled: AtomicBool::new(false),
                grant: Mutex::new(None),
                expires: now() + 900000,
            });
            pending.insert(request_id.into(), value.clone());
            value
        };
        let result = (|| {
            let saved = recovery
                .as_ref()
                .map(|request| self.recovery_snapshot(&plan, request))
                .transpose()?;
            let prepared = preflight_with_cancel(plan, approval.cancel.clone())?;
            if let Some(saved) = &saved {
                recovery::bind_target(saved, &prepared)?;
            }
            let recovery_description = recovery
                .as_ref()
                .zip(saved.as_ref())
                .map(|(request, saved)| request.describe(saved))
                .unwrap_or_default();
            let description = format!(
                "目标窗口：{}\n进程：{}\n\n{}\n\n流程摘要：{}",
                prepared.target.title,
                prepared.target.process_id,
                prepared
                    .plan
                    .steps
                    .iter()
                    .enumerate()
                    .map(|(i, s)| format!(
                        "{}. {}：{}",
                        i + 1,
                        s.action.label(),
                        s.locator.description()
                    ))
                    .collect::<Vec<_>>()
                    .join("\n"),
                prepared.preview["digest"].as_str().unwrap_or("")
            );
            let request = worker::Input {
                target: prepared.target.clone(),
                root_id: None,
                step: None,
                input: None,
                approval: Some(format!(
                    "请核对目标和全部步骤。授权仅用于本次流程，10 分钟后失效。填写内容会逐步确认。\n\n{description}\n\n{recovery_description}"
                )),
            };
            process::run(&request, 300000, approval.cancel.clone())?;
            if approval.cancel.load(Ordering::SeqCst) {
                return Err("BLK-RPA-CANCELLED".into());
            }
            let grant = if let Some(request) = &recovery {
                recovery::verify_checks(request, &prepared, approval.cancel.clone())?;
                self.insert_checkpoint(prepared, saved)?
            } else {
                self.authorize(prepared)?
            };
            *approval.grant.lock().map_err(|_| "BLK-RPA-STATE-001")? =
                grant["sessionId"].as_str().map(str::to_owned);
            if approval.cancel.load(Ordering::SeqCst) {
                if let Some(token) = grant["sessionId"].as_str() {
                    self.stop(token)?;
                }
                return Err("BLK-RPA-CANCELLED".into());
            }
            Ok(grant)
        })();
        approval.unsettled.store(
            result
                .as_ref()
                .is_err_and(|code| code == "BLK-RPA-SETTLEMENT-001"),
            Ordering::SeqCst,
        );
        approval.active.store(false, Ordering::SeqCst);
        // Keep successful request-to-grant bindings for late IPC cancellation.
        // Failed settlement records must also remain reachable by shutdown.
        if result.is_err()
            && !approval.cancel.load(Ordering::SeqCst)
            && !approval.unsettled.load(Ordering::SeqCst)
        {
            self.approvals
                .lock()
                .map_err(|_| "BLK-RPA-STATE-001")?
                .remove(request_id);
        }
        result
    }
    pub fn cancel_authorization(&self, request_id: &str) -> Result<(), String> {
        if !crate::project_store::stable(request_id) || request_id.len() > 200 {
            return Err("BLK-RPA-PLAN-001".into());
        }
        let approval = {
            let mut pending = self.approvals.lock().map_err(|_| "BLK-RPA-STATE-001")?;
            if !pending.contains_key(request_id) && pending.len() >= 16 {
                return Err("BLK-RPA-LIMIT-001".into());
            }
            pending
                .entry(request_id.into())
                .or_insert_with(|| {
                    Arc::new(Approval {
                        cancel: Arc::new(AtomicBool::new(true)),
                        active: AtomicBool::new(false),
                        unsettled: AtomicBool::new(false),
                        grant: Mutex::new(None),
                        expires: now() + 900000,
                    })
                })
                .clone()
        };
        approval.cancel.store(true, Ordering::SeqCst);
        let started = std::time::Instant::now();
        while approval.active.load(Ordering::SeqCst) && started.elapsed() < Duration::from_secs(5) {
            std::thread::sleep(Duration::from_millis(10));
        }
        if approval.active.load(Ordering::SeqCst) || approval.unsettled.load(Ordering::SeqCst) {
            return Err("BLK-RPA-SETTLEMENT-001".into());
        }
        if let Some(token) = approval
            .grant
            .lock()
            .map_err(|_| "BLK-RPA-STATE-001")?
            .as_ref()
        {
            self.stop(token)?;
        }
        Ok(())
    }
    /// Call only after trusted native confirmation of Prepared.preview.
    pub fn authorize(&self, prepared: Prepared) -> Result<Value, String> {
        target::verify(&prepared.target)?;
        self.insert(prepared)
    }
    fn insert(&self, prepared: Prepared) -> Result<Value, String> {
        self.insert_checkpoint(prepared, None)
    }
    fn insert_checkpoint(
        &self,
        prepared: Prepared,
        saved: Option<journal::Snapshot>,
    ) -> Result<Value, String> {
        let mut sessions = self.sessions.lock().map_err(|_| "BLK-RPA-STATE-001")?;
        if self.closing.load(Ordering::SeqCst) {
            return Err("BLK-RPA-STATE-001".into());
        }
        sessions.retain(|_, slot| {
            slot.state
                .lock()
                .map(|s| s.active || s.expires > now())
                .unwrap_or(true)
        });
        if sessions.len() >= 16 {
            return Err("BLK-RPA-LIMIT-001".into());
        }
        let token = format!("rpa-{}", uuid::Uuid::new_v4());
        let expires = now() + 600000;
        let grant = json!({"schemaVersion":"blocky.rpa-grant/v1","sessionId":token,"targetIdentity":prepared.target.identity,"actions":prepared.plan.steps.iter().map(|s|s.action).collect::<Vec<_>>(),"expiresAt":expires,"coordinateFallback":false});
        let saved = saved
            .map(|saved| {
                self.journal
                    .as_ref()
                    .ok_or("BLK-RPA-JOURNAL-001")?
                    .claim(&saved)
            })
            .transpose()?;
        let mut session = Session {
            checkpoint_id: saved.as_ref().map(|s| s.checkpoint_id.clone()).or_else(|| {
                self.journal
                    .as_ref()
                    .map(|_| format!("checkpoint-{}", uuid::Uuid::new_v4()))
            }),
            checkpoint_revision: saved.as_ref().map(|s| s.revision).unwrap_or(0),
            plan: prepared.plan,
            target: saved
                .as_ref()
                .map(|s| s.target.clone())
                .unwrap_or(prepared.target),
            root_id: prepared.root_id,
            expires,
            status: "ready",
            next: saved.as_ref().map(|s| s.next).unwrap_or(0),
            active: false,
            receipts: saved
                .as_ref()
                .map(|s| s.receipts.clone())
                .unwrap_or_default(),
            cancel: Arc::new(AtomicBool::new(false)),
        };
        if saved.is_none() {
            self.persist(&mut session)?;
        }
        sessions.insert(
            token,
            Arc::new(Slot {
                state: Mutex::new(session),
                settled: Condvar::new(),
            }),
        );
        Ok(grant)
    }
    fn slot(&self, token: &str) -> Result<Arc<Slot>, String> {
        self.sessions
            .lock()
            .map_err(|_| "BLK-RPA-STATE-001")?
            .get(token)
            .cloned()
            .ok_or_else(|| "BLK-RPA-PERM-001".into())
    }
    pub fn status(&self, token: &str) -> Result<Value, String> {
        let slot = self.slot(token)?;
        let s = slot.state.lock().map_err(|_| "BLK-RPA-STATE-001")?;
        Ok(
            json!({"status":s.status,"nextStep":s.plan.steps.get(s.next).map(|s|&s.step_id),"active":s.active,"receipts":s.receipts,"expiresAt":s.expires,"checkpointId":s.checkpoint_id}),
        )
    }
    pub fn step(&self, token: &str, step_id: &str, input: Option<String>) -> Result<Value, String> {
        if let Some(reference) = self.input_reference(token, step_id)? {
            if reference.kind != "manual-input" {
                return Err("BLK-RPA-SENSITIVE-001".into());
            }
            let text = input.as_deref().ok_or("BLK-RPA-INPUT-002")?;
            if text.len() > 16384 || text.contains('\0') {
                return Err("BLK-RPA-INPUT-001".into());
            }
        }
        self.step_with(token, step_id, input, |request,timeout,cancel| {
            if let Some(text)=&request.input {
                let destination=request.step.as_ref().map(|s|s.locator.description()).unwrap_or_default();
                let confirm=worker::Input{target:request.target.clone(),root_id:None,step:None,input:None,approval:Some(format!("目标窗口：{}\n控件：{destination}\n以下内容将填入该控件。请核对后继续；请勿输入密码或密钥。\n\n{text}",request.target.title))};
                process::run(&confirm,300000,cancel.clone())?;
            }
            // A long human review must not extend the grant lifetime.
            let slot=self.slot(token)?; let expires=slot.state.lock().map_err(|_|"BLK-RPA-STATE-001")?.expires;
            if expires<=now() {return Err("BLK-RPA-PERM-001".into());}
            process::run(request,timeout.min(expires.saturating_sub(now())),cancel)
        })
    }
    pub fn input_reference(
        &self,
        token: &str,
        step_id: &str,
    ) -> Result<Option<protocol::InputRef>, String> {
        let slot = self.slot(token)?;
        let s = slot.state.lock().map_err(|_| "BLK-RPA-STATE-001")?;
        if s.expires <= now() {
            return Err("BLK-RPA-PERM-001".into());
        }
        s.plan
            .steps
            .get(s.next)
            .filter(|step| step.step_id == step_id)
            .map(|step| step.value.clone())
            .ok_or_else(|| "BLK-RPA-STEP-001".into())
    }
    fn step_with(
        &self,
        token: &str,
        step_id: &str,
        input: Option<String>,
        run: impl FnOnce(&worker::Input, u64, Arc<AtomicBool>) -> Result<Value, String>,
    ) -> Result<Value, String> {
        let slot = self.slot(token)?;
        let (request, cancel, timeout) = {
            let mut s = slot.state.lock().map_err(|_| "BLK-RPA-STATE-001")?;
            while s.status == "paused"
                && !s.active
                && !s.cancel.load(Ordering::SeqCst)
                && s.expires > now()
            {
                s = slot
                    .settled
                    .wait_timeout(s, Duration::from_millis(100))
                    .map_err(|_| "BLK-RPA-STATE-001")?
                    .0;
            }
            if self.closing.load(Ordering::SeqCst) || s.expires <= now() {
                return Err("BLK-RPA-PERM-001".into());
            }
            if s.active || !["ready", "running"].contains(&s.status) {
                return Err("BLK-RPA-STATE-001".into());
            }
            let step = s
                .plan
                .steps
                .get(s.next)
                .filter(|step| step.step_id == step_id)
                .cloned()
                .ok_or("BLK-RPA-STEP-001")?;
            if step.action == Action::Fill && input.is_none()
                || step.action != Action::Fill && input.is_some()
                || input
                    .as_ref()
                    .is_some_and(|v| v.len() > 16384 || v.contains('\0'))
            {
                return Err("BLK-RPA-INPUT-002".into());
            }
            if s.receipts.iter().any(|r| r.step_id == step_id) {
                return Err("BLK-RPA-RECEIPT-002".into());
            }
            if let Some(key) = &step.effect_key {
                let identity = s.target.identity.clone();
                s.receipts.push(Receipt {
                    step_id: step.step_id.clone(),
                    effect_key: key.clone(),
                    target_identity: identity,
                    status: "uncertain".into(),
                    verified: false,
                });
            }
            s.active = true;
            s.status = "running";
            if let Err(code) = self.persist(&mut s) {
                s.active = false;
                s.status = "persistence-failed";
                slot.settled.notify_all();
                return Err(code);
            }
            let timeout = step.timeout_ms.min(s.expires.saturating_sub(now()));
            (
                worker::Input {
                    target: s.target.clone(),
                    root_id: Some(s.root_id.clone()),
                    step: Some(step),
                    input,
                    approval: None,
                },
                s.cancel.clone(),
                timeout,
            )
        };
        let result = run(&request, timeout, cancel.clone());
        let mut s = slot.state.lock().map_err(|_| "BLK-RPA-STATE-001")?;
        if result
            .as_ref()
            .is_err_and(|code| code == "BLK-RPA-SETTLEMENT-001")
        {
            s.status = "settlement-failed";
            let _ = self.persist(&mut s);
            slot.settled.notify_all();
            return result;
        }
        s.active = false;
        let result = if cancel.load(Ordering::SeqCst) {
            Err("BLK-RPA-CANCELLED".into())
        } else {
            result
        };
        if result.is_ok() {
            if let Some(receipt) = s.receipts.iter_mut().find(|r| r.step_id == step_id) {
                receipt.status = "completed".into();
            }
            s.next += 1;
            if s.next == s.plan.steps.len() {
                s.status = "completed";
            } else if s.status != "paused" {
                s.status = "ready";
            }
        } else {
            s.status = if cancel.load(Ordering::SeqCst) {
                "stopped"
            } else {
                "failed"
            };
        }
        let saved = self.persist(&mut s);
        if saved.is_err() {
            s.status = "persistence-failed";
        }
        slot.settled.notify_all();
        saved?;
        result
    }
    pub fn pause(&self, token: &str) -> Result<(), String> {
        let slot = self.slot(token)?;
        let mut s = slot.state.lock().map_err(|_| "BLK-RPA-STATE-001")?;
        if !["ready", "running"].contains(&s.status) {
            return Err("BLK-RPA-STATE-001".into());
        }
        s.status = "paused";
        if let Err(code) = self.persist(&mut s) {
            s.status = "persistence-failed";
            s.cancel.store(true, Ordering::SeqCst);
            slot.settled.notify_all();
            return Err(code);
        }
        Ok(())
    }
    pub fn resume(&self, token: &str) -> Result<(), String> {
        let slot = self.slot(token)?;
        let mut s = slot.state.lock().map_err(|_| "BLK-RPA-STATE-001")?;
        if s.status != "paused" || s.expires <= now() {
            return Err("BLK-RPA-STATE-001".into());
        }
        target::verify(&s.target)?;
        s.status = if s.active { "running" } else { "ready" };
        if let Err(code) = self.persist(&mut s) {
            s.status = "persistence-failed";
            s.cancel.store(true, Ordering::SeqCst);
            slot.settled.notify_all();
            return Err(code);
        }
        slot.settled.notify_all();
        Ok(())
    }
    pub fn stop(&self, token: &str) -> Result<(), String> {
        let slot = self.slot(token)?;
        let mut s = slot.state.lock().map_err(|_| "BLK-RPA-STATE-001")?;
        if s.status == "settlement-failed" {
            return Err("BLK-RPA-SETTLEMENT-001".into());
        }
        if !s.active && ["completed", "stopped"].contains(&s.status) {
            return Ok(());
        }
        s.cancel.store(true, Ordering::SeqCst);
        s.status = "stopping";
        slot.settled.notify_all();
        let (state, timed) = slot
            .settled
            .wait_timeout_while(s, Duration::from_secs(5), |s| {
                s.active && s.status != "settlement-failed"
            })
            .map_err(|_| "BLK-RPA-STATE-001")?;
        s = state;
        if s.status == "settlement-failed" || timed.timed_out() && s.active {
            return Err("BLK-RPA-SETTLEMENT-001".into());
        }
        s.status = "stopped";
        self.persist(&mut s).inspect_err(|_| {
            s.status = "persistence-failed";
        })
    }
    pub fn shutdown(&self) -> Result<(), String> {
        self.closing.store(true, Ordering::SeqCst);
        let pending: Vec<_> = self
            .approvals
            .lock()
            .map_err(|_| "BLK-RPA-STATE-001")?
            .keys()
            .cloned()
            .collect();
        let tokens: Vec<_> = self
            .sessions
            .lock()
            .map_err(|_| "BLK-RPA-STATE-001")?
            .keys()
            .cloned()
            .collect();
        for token in &tokens {
            let slot = self.slot(token)?;
            slot.state
                .lock()
                .map_err(|_| "BLK-RPA-STATE-001")?
                .cancel
                .store(true, Ordering::SeqCst);
            slot.settled.notify_all();
        }
        // Broadcast first: one failed settlement cannot leave other workers running.
        for approval in self
            .approvals
            .lock()
            .map_err(|_| "BLK-RPA-STATE-001")?
            .values()
        {
            approval.cancel.store(true, Ordering::SeqCst);
        }
        let mut failure = None;
        for id in pending {
            if let Err(error) = self.cancel_authorization(&id) {
                failure.get_or_insert(error);
            }
        }
        for token in &tokens {
            if let Err(error) = self.stop(token) {
                failure.get_or_insert(error);
            }
        }
        if let Some(error) = failure {
            return Err(error);
        }
        self.sessions
            .lock()
            .map_err(|_| "BLK-RPA-STATE-001")?
            .clear();
        self.approvals
            .lock()
            .map_err(|_| "BLK-RPA-STATE-001")?
            .clear();
        Ok(())
    }
}
