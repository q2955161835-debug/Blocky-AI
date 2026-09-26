//! Recovery reuses attended authorization; saved receipts never carry a grant.
use super::{
    Prepared, RpaHost,
    journal::Snapshot,
    owner::Owner,
    process,
    protocol::{Action, Locator, Plan, Step},
    worker,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Check {
    pub step_id: String,
    pub locator: Locator,
    pub expected_text: Option<String>,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Request {
    pub schema_version: String,
    pub checkpoint_id: String,
    pub revision: u64,
    pub checks: Vec<Check>,
}
pub(super) fn eligible(saved: &Snapshot) -> Result<(), String> {
    saved.target.windows().map_err(|_| "BLK-RPA-RECOVERY-002")?;
    if saved
        .owner
        .as_ref()
        .ok_or("BLK-RPA-RECOVERY-001")?
        .is_alive()?
    {
        return Err("BLK-RPA-RECOVERY-001".into());
    }
    if saved.next >= saved.plan.steps.len() || saved.status == "settlement-failed" {
        return Err("BLK-RPA-RECOVERY-002".into());
    }
    if saved.receipts.iter().any(|r| r.status != "completed") {
        return Err("BLK-RPA-RECEIPT-002".into());
    }
    Ok(())
}
impl Request {
    pub(super) fn validate(&self, saved: &Snapshot) -> Result<(), String> {
        if self.schema_version != "blocky.rpa-recovery/v1"
            || self.checkpoint_id != saved.checkpoint_id
            || self.revision != saved.revision
        {
            return Err("BLK-RPA-JOURNAL-003".into());
        }
        if self.checks.len() != saved.receipts.len()
            || self.checks.len() > 100
            || serde_json::to_vec(self)
                .map_err(|_| "BLK-RPA-RECOVERY-003")?
                .len()
                > 32768
        {
            return Err("BLK-RPA-RECOVERY-003".into());
        }
        let mut ids = HashSet::new();
        for check in &self.checks {
            if !ids.insert(&check.step_id)
                || !saved.receipts.iter().any(|r| r.step_id == check.step_id)
                || !matches!(check.locator, Locator::Uia { .. })
                || check
                    .expected_text
                    .as_ref()
                    .is_some_and(|s| s.len() > 1024 || s.contains('\0'))
            {
                return Err("BLK-RPA-RECOVERY-003".into());
            }
            Plan {
                schema_version: "blocky.rpa/v1".into(),
                plan_id: "recovery-check".into(),
                target: saved.plan.target.clone(),
                steps: vec![check.probe()],
            }
            .validate()?;
        }
        Ok(())
    }
    pub(super) fn describe(&self, saved: &Snapshot) -> String {
        format!(
            "恢复执行记录：{}\n已完成 {} 步，只继续其后的步骤。以下条件必须与目标当前状态一致：\n{}",
            saved.checkpoint_id,
            saved.next,
            self.checks
                .iter()
                .map(|check| format!(
                    "{} → {}：{}",
                    check.step_id,
                    check.locator.description(),
                    check
                        .expected_text
                        .as_deref()
                        .map(|text| format!("文本等于 {text}"))
                        .unwrap_or_else(|| "控件存在".into())
                ))
                .collect::<Vec<_>>()
                .join("\n")
        )
    }
}
impl Check {
    pub(super) fn probe(&self) -> Step {
        Step {
            step_id: self.step_id.clone(),
            action: if self.expected_text.is_some() {
                Action::Read
            } else {
                Action::Find
            },
            locator: self.locator.clone(),
            value: None,
            timeout_ms: 2000,
            effect_key: None,
        }
    }
}
pub(super) fn new_owner() -> Result<Owner, String> {
    Owner::current()
}
pub(super) fn bind_target(saved: &Snapshot, prepared: &Prepared) -> Result<(), String> {
    if saved.target.identity() != prepared.target.identity()
        || saved.target.windows()?.class_name != prepared.target.windows()?.class_name
        || saved.root_id != prepared.root_id
    {
        return Err("BLK-RPA-TARGET-001".into());
    }
    Ok(())
}
pub(super) fn verify_checks(
    request: &Request,
    prepared: &Prepared,
    cancel: Arc<AtomicBool>,
) -> Result<(), String> {
    verify_with(request, prepared, cancel, |input, timeout, signal| {
        process::run(input, timeout, signal)
    })
}
pub(super) fn verify_with(
    request: &Request,
    prepared: &Prepared,
    cancel: Arc<AtomicBool>,
    mut perform: impl FnMut(&worker::Input, u64, Arc<AtomicBool>) -> Result<Value, String>,
) -> Result<(), String> {
    let deadline = std::time::Instant::now();
    for check in &request.checks {
        if cancel.load(Ordering::SeqCst) {
            return Err("BLK-RPA-CANCELLED".into());
        }
        let remaining = 30000u64.saturating_sub(deadline.elapsed().as_millis() as u64);
        if remaining == 0 {
            return Err("BLK-RPA-TIMEOUT-001".into());
        }
        let result = perform(
            &worker::Input {
                target: prepared.target.clone(),
                capture_path: None, root_id: Some(prepared.root_id.clone()),
                step: Some(check.probe()),
                input: None,
                approval: None,
            },
            remaining.min(2000),
            cancel.clone(),
        )?;
        if match &check.expected_text {
            Some(text) => result["text"].as_str() != Some(text),
            None => result["found"] != true,
        } {
            return Err("BLK-RPA-RECOVERY-004".into());
        }
    }
    if cancel.load(Ordering::SeqCst) {
        return Err("BLK-RPA-CANCELLED".into());
    }
    super::target::verify(prepared.target.windows()?)
}
impl RpaHost {
    pub fn recover_attended(
        &self,
        request_id: &str,
        plan: Plan,
        recovery: Request,
    ) -> Result<Value, String> {
        self.authorize_request(request_id, plan, Some(recovery), None)
    }
    pub(super) fn recovery_snapshot(
        &self,
        plan: &Plan,
        request: &Request,
    ) -> Result<Snapshot, String> {
        let saved = self
            .journal
            .as_ref()
            .ok_or("BLK-RPA-JOURNAL-001")?
            .read_bound(&request.checkpoint_id, plan)?;
        request.validate(&saved)?;
        eligible(&saved)?;
        Ok(saved)
    }
}
