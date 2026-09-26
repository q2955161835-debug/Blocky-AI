//! Explicit deletion of settled, non-resumable execution evidence.
use super::journal::Snapshot;
use serde::Deserialize;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Request {
    pub schema_version: String,
    pub checkpoint_id: String,
    pub revision: u64,
}
impl Request {
    pub(super) fn validate(&self) -> Result<(), String> {
        if self.schema_version != "blocky.rpa-checkpoint-delete/v1"
            || !self.checkpoint_id.starts_with("checkpoint-")
            || self.checkpoint_id.len() > 80
            || !crate::project_store::stable(&self.checkpoint_id)
            || !(1..=2048).contains(&self.revision)
        {
            return Err("BLK-RPA-JOURNAL-002".into());
        }
        Ok(())
    }
}
pub(super) fn eligible(saved: &Snapshot) -> Result<(), String> {
    if !saved.settled
        || !["completed", "stopped", "failed"].contains(&saved.status.as_str())
        || saved.receipts.iter().any(|r| r.status != "completed")
    {
        return Err("BLK-RPA-CLEANUP-001".into());
    }
    if saved.owner.as_ref().ok_or("BLK-RPA-RECOVERY-001")?.is_alive()? {
        return Err("BLK-RPA-RECOVERY-001".into());
    }
    if super::recovery::eligible(saved).is_ok() {
        return Err("BLK-RPA-CLEANUP-002".into());
    }
    Ok(())
}
