//! Native-only execution custody. Persisted metadata is not a settlement capability.
use super::protocol::require;
use crate::{process_identity::Identity, process_worker::Worker};
use serde::{Deserialize, Serialize};
use std::{
    ffi::OsString,
    fs::File,
    path::Path,
    sync::{Arc, Mutex},
};
const OWNER: &str = "BLK-WORKFLOW-OWNER";

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Binding {
    profile: String,
    task_id: String,
    lease_id: String,
    owner: Identity,
    worker: Identity,
    job_id: String,
    settled: bool,
}
impl Binding {
    pub(super) fn valid(
        &self,
        profile: &str,
        task: &str,
        lease: Option<&str>,
        owner: Option<&Identity>,
    ) -> bool {
        self.profile == profile
            && self.task_id == task
            && lease == Some(self.lease_id.as_str())
            && owner == Some(&self.owner)
            && self.worker.process_id != 0
            && self.worker.created != 0
            && self.worker != self.owner
            && uuid::Uuid::parse_str(&self.job_id).is_ok_and(|v| v.to_string() == self.job_id)
    }
    pub(super) fn settled(&self) -> bool {
        self.settled
    }
    pub(super) fn settle(&mut self, proof: &Stopped) -> Result<(), String> {
        let mut expected = self.clone();
        expected.settled = false;
        require(expected == proof.0, OWNER)?;
        self.settled = true;
        Ok(())
    }
}
/// Cannot be deserialized or manufactured from the persisted Binding.
pub(super) struct Stopped(Binding);

pub(super) struct Execution {
    worker: Arc<Mutex<Worker>>,
    owner: Identity,
    job_id: String,
    binding: Option<Binding>,
    stopped: bool,
}
impl Execution {
    /// Launch inputs are supplied only by the pinned native runtime launcher.
    pub(super) fn spawn(executable: &Path, arguments: &[OsString]) -> Result<Self, String> {
        let owner = Identity::current().map_err(|_| OWNER)?;
        let job_id = uuid::Uuid::new_v4().to_string();
        let worker = Worker::spawn(
            executable,
            arguments,
            &format!("Local\\Blocky-Workflow-{job_id}"),
        )?;
        Ok(Self {
            worker: Arc::new(Mutex::new(worker)),
            owner,
            job_id,
            binding: None,
            stopped: false,
        })
    }
    pub(super) fn prepare_binding(
        &self,
        profile: &str,
        task: &str,
        lease: &str,
        owner: &Identity,
    ) -> Result<Binding, String> {
        require(
            !self.stopped
                && !self.worker.lock().map_err(|_| OWNER)?.is_stopped()
                && self.binding.is_none()
                && *owner == self.owner
                && Identity::current().map_err(|_| OWNER)? == self.owner,
            OWNER,
        )?;
        Ok(Binding {
            profile: profile.into(),
            task_id: task.into(),
            lease_id: lease.into(),
            owner: self.owner.clone(),
            worker: self.worker.lock().map_err(|_| OWNER)?.identity().clone(),
            job_id: self.job_id.clone(),
            settled: false,
        })
    }
    // Called only after the Store durably wrote the prepared binding.
    pub(super) fn arm(&mut self, binding: Binding) {
        self.binding = Some(binding);
    }
    #[cfg(test)]
    pub(super) fn resume(&mut self) -> Result<(), String> {
        require(
            !self.stopped
                && self.binding.is_some()
                && Identity::current().map_err(|_| OWNER)? == self.owner,
            OWNER,
        )?;
        self.worker.lock().map_err(|_| OWNER)?.resume()
    }
    /// Fixed trusted Runtime bootstrap only. Business effects await native open acknowledgement.
    pub(super) fn bootstrap(&mut self) -> Result<(), String> {
        require(
            self.binding.is_none()
                && !self.stopped
                && Identity::current().map_err(|_| OWNER)? == self.owner,
            OWNER,
        )?;
        self.worker.lock().map_err(|_| OWNER)?.resume()
    }
    pub(super) fn task_view(&self) -> Result<Self, String> {
        require(
            self.binding.is_none()
                && !self.stopped
                && Identity::current().map_err(|_| OWNER)? == self.owner
                && !self.worker.lock().map_err(|_| OWNER)?.is_stopped(),
            OWNER,
        )?;
        Ok(Self {
            worker: self.worker.clone(),
            owner: self.owner.clone(),
            job_id: self.job_id.clone(),
            binding: None,
            stopped: false,
        })
    }
    pub(super) fn stdin(&mut self) -> Option<File> {
        self.worker.lock().ok()?.input()?.try_clone().ok()
    }
    pub(super) fn take_stdout(&mut self) -> Option<File> {
        self.worker.lock().ok()?.take_output()
    }
    pub(super) fn settle_process(&mut self) -> Result<(), String> {
        self.worker.lock().map_err(|_| OWNER)?.stop()?;
        self.stopped = true;
        Ok(())
    }
    pub(super) fn stop(&mut self) -> Result<Stopped, String> {
        self.settle_process()?;
        require(Identity::current().map_err(|_| OWNER)? == self.owner, OWNER)?;
        Ok(Stopped(self.binding.clone().ok_or(OWNER)?))
    }
}
