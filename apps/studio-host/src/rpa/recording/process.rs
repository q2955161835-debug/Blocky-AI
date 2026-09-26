use super::{
    protocol::{Options, validate_result},
    worker::SCHEMA,
};
use crate::rpa::{ipc::PipeProcess, target::Target};
use serde_json::{Value, json};
use std::{
    path::Path,
    process::Command,
    sync::{Arc, atomic::AtomicBool},
};

/// Parent owns a bounded Job; this handle alone never grants plan execution.
pub(in crate::rpa) struct RecordingProcess {
    process: PipeProcess,
    options: Options,
}
impl RecordingProcess {
    pub fn start(
        target: Target,
        options: Options,
        cancel: Arc<AtomicBool>,
    ) -> Result<Self, String> {
        let exe = std::env::current_exe().map_err(|_| "BLK-RPA-WORKER-001")?;
        Self::start_at(&exe, target, options, cancel)
    }
    pub(in crate::rpa) fn start_at(
        exe: &Path,
        target: Target,
        options: Options,
        cancel: Arc<AtomicBool>,
    ) -> Result<Self, String> {
        options.validate()?;
        if options.target.kind != "windows" || options.target.identity != target.identity {
            return Err("BLK-RPA-TARGET-001".into());
        }
        crate::rpa::target::verify(&target)?;
        let mut command = Command::new(exe);
        command
            .env_clear()
            .arg("--blocky-rpa-recording-worker")
            .current_dir(exe.parent().ok_or("BLK-RPA-WORKER-001")?);
        let mut process = PipeProcess::spawn(command, None, SCHEMA, cancel.clone())?;
        let status = process.request(
            json!({"kind":"start","target":target,"options":options}),
            5000,
            cancel,
        )?;
        validate_status(&status, &options)?;
        Ok(Self { process, options })
    }
    pub fn status(&mut self, cancel: Arc<AtomicBool>) -> Result<Value, String> {
        let value = self
            .process
            .request(json!({"kind":"status"}), 3000, cancel)?;
        if let Err(code) = validate_status(&value, &self.options) {
            self.process.terminate()?;
            return Err(code);
        }
        Ok(value)
    }
    pub fn stop(&mut self) -> Result<Value, String> {
        let response = self.process.request(
            json!({"kind":"stop"}),
            5000,
            Arc::new(AtomicBool::new(false)),
        );
        // Always reclaim the worker, even when a provider stops responding during unsubscribe.
        self.process.terminate()?;
        let value = response?;
        validate_result(&value, &self.options)?;
        Ok(value)
    }
    pub fn terminate(&mut self) -> Result<(), String> {
        self.process.terminate()
    }
    #[cfg(test)]
    pub fn child_exited(&mut self) -> bool {
        self.process.child_exited()
    }
}
fn validate_status(value: &Value, options: &Options) -> Result<(), String> {
    let valid = value.as_object().is_some_and(|o| {
        o.keys().all(|k| {
            [
                "sessionId",
                "state",
                "count",
                "omitted",
                "startedAt",
                "expiresAt",
                "reason",
            ]
            .contains(&k.as_str())
        })
    }) && value["sessionId"] == options.session_id
        && matches!(value["state"].as_str(), Some("recording" | "stopped"))
        && value["count"].as_u64().is_some_and(|n| n <= 100)
        && value["omitted"].as_u64().is_some_and(|n| n <= 10000)
        && value["startedAt"].as_u64().is_some_and(|n| {
            n <= 9007199254140991 && value["expiresAt"].as_u64() == Some(n + 600000)
        })
        && if value["state"] == "stopped" {
            matches!(
                value["reason"].as_str(),
                Some("stopped" | "expired" | "limit" | "target-lost" | "capture-failed")
            )
        } else {
            value.get("reason").is_none()
        };
    if valid {
        Ok(())
    } else {
        Err("BLK-RPA-WIRE-001".into())
    }
}
