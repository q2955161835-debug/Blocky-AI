//! Recording consent owns one capture session, never an execution grant.
use super::{backend::Backend, request::Request};
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{
        Arc, Condvar, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, Instant},
};
enum Phase {
    Pending,
    Active(Backend),
    Finished {
        result: Result<Option<Value>, String>,
        unsettled: Option<Backend>,
    },
}

#[cfg(test)]
mod tests {
    use super::*;
    fn request(id: &str) -> Request {
        Request {
            schema_version: "blocky.rpa-recording-start/v1".into(),
            session_id: id.into(),
            project_id: "project-one".into(),
            target: crate::rpa::protocol::TargetRef {
                kind: "browser".into(),
                identity: "http://127.0.0.1:54321".into(),
            },
            url: Some("http://127.0.0.1:54321/".into()),
        }
    }
    #[test]
    fn cancellation_before_start_prevents_late_consent() {
        let host = Host::default();
        assert_eq!(
            host.stop("project-one", "recording-one").unwrap()["state"],
            "stopped"
        );
        assert_eq!(
            host.start_with(request("recording-one"), |_, _, _| panic!(
                "cancelled request must not prompt"
            ))
            .unwrap_err(),
            "BLK-RPA-CANCELLED"
        );
    }
    #[test]
    fn stop_during_consent_settles_without_starting_capture() {
        let host = Arc::new(Host::default());
        let worker = host.clone();
        let (ready, wait) = std::sync::mpsc::channel();
        let running = std::thread::spawn(move || {
            worker.start_with(request("recording-one"), |_, _, cancel| {
                ready.send(()).unwrap();
                let start = Instant::now();
                while !cancel.load(Ordering::SeqCst) && start.elapsed() < Duration::from_secs(2) {
                    std::thread::sleep(Duration::from_millis(5));
                }
                Ok(())
            })
        });
        wait.recv_timeout(Duration::from_secs(1)).unwrap();
        assert_eq!(
            host.status("project-one", "recording-one").unwrap()["state"],
            "awaiting-approval"
        );
        assert!(host.status("another-project", "recording-one").is_err());
        assert!(
            host.start_with(request("recording-two"), |_, _, _| panic!(
                "only one pending recording"
            ))
            .is_err()
        );
        assert!(host.stop("project-one", "recording-one").unwrap()["recording"].is_null());
        assert_eq!(running.join().unwrap().unwrap_err(), "BLK-RPA-CANCELLED");
        host.shutdown().unwrap();
    }
    #[test]
    fn settled_start_errors_do_not_block_exit_but_unconfirmed_settlement_does() {
        let host = Host::default();
        assert_eq!(
            host.start_with(request("recording-one"), |_, _, _| Err(
                "BLK-RPA-UIA-001".into()
            ))
            .unwrap_err(),
            "BLK-RPA-UIA-001"
        );
        let receipt = host.stop("project-one", "recording-one").unwrap();
        assert_eq!(receipt["settled"], true);
        assert_eq!(receipt["code"], "BLK-RPA-UIA-001");
        assert!(receipt["recording"].is_null());
        host.shutdown().unwrap();
        let failed = Host::default();
        failed
            .start_with(request("recording-one"), |_, _, _| {
                Err("BLK-RPA-SETTLEMENT-001".into())
            })
            .unwrap_err();
        assert!(failed.shutdown().is_err());
        assert!(
            failed
                .start_with(request("recording-two"), |_, _, _| panic!(
                    "settlement unconfirmed"
                ))
                .is_err()
        );
    }
}
struct Slot {
    session_id: String,
    project_id: String,
    cancel: Arc<AtomicBool>,
    phase: Mutex<Phase>,
    changed: Condvar,
}
#[derive(Default)]
pub struct Host {
    root: Option<PathBuf>,
    slot: Mutex<Option<Arc<Slot>>>,
    closing: AtomicBool,
    cancelled: Mutex<HashMap<(String, String), u64>>,
}
impl Host {
    pub fn new(root: PathBuf) -> Self {
        Self {
            root: Some(root),
            ..Self::default()
        }
    }
    pub fn start(&self, request: Request) -> Result<Value, String> {
        self.start_with(request, |binding, description, cancel| {
            crate::rpa::process::run(
                &crate::rpa::worker::Input {
                    target: binding,
                    root_id: None,
                    step: None,
                    input: None,
                    approval: Some(description),
                },
                300000,
                cancel,
            )
            .and_then(|response| {
                if response == json!({"approved":true}) {
                    Ok(())
                } else {
                    Err("BLK-RPA-PERM-001".into())
                }
            })
        })
    }
    fn start_with(
        &self,
        request: Request,
        consent: impl FnOnce(
            crate::rpa::binding::Binding,
            String,
            Arc<AtomicBool>,
        ) -> Result<(), String>,
    ) -> Result<Value, String> {
        let (options, binding) = request.prepare()?;
        let slot = {
            let mut cancelled = self.cancelled.lock().map_err(|_| "BLK-RPA-STATE-001")?;
            cancelled.retain(|_, expires| *expires > crate::rpa::now());
            if cancelled.contains_key(&(request.project_id.clone(), request.session_id.clone())) {
                return Err("BLK-RPA-CANCELLED".into());
            }
            let mut current = self.slot.lock().map_err(|_| "BLK-RPA-STATE-001")?;
            if self.closing.load(Ordering::SeqCst) {
                return Err("BLK-RPA-STATE-001".into());
            }
            if let Some(previous) = current.as_ref() {
                if previous.session_id == request.session_id
                    || !matches!(
                        &*previous.phase.lock().map_err(|_| "BLK-RPA-STATE-001")?,
                        Phase::Finished { unsettled: None,result } if !result.as_ref().is_err_and(|code|code=="BLK-RPA-SETTLEMENT-001")
                    )
                {
                    return Err("BLK-RPA-STATE-001".into());
                }
            }
            let slot = Arc::new(Slot {
                session_id: request.session_id.clone(),
                project_id: request.project_id.clone(),
                cancel: Arc::new(AtomicBool::new(false)),
                phase: Mutex::new(Phase::Pending),
                changed: Condvar::new(),
            });
            *current = Some(slot.clone());
            slot
        };
        let result = (|| {
            let description = format!(
                "录制目标：\n{}\n\n仅记录当前目标的操作和定位信息，不读取输入正文。最多录制 100 步或 10 分钟。密码填写只生成手动输入步骤。停止后先审查积木草案，执行时另行授权。{}",
                binding.label(),
                request
                    .url
                    .as_ref()
                    .map(|url| format!("\n将打开全新隔离浏览器：{url}"))
                    .unwrap_or_default()
            );
            consent(binding.clone(), description, slot.cancel.clone())?;
            if slot.cancel.load(Ordering::SeqCst) {
                return Err("BLK-RPA-CANCELLED".into());
            }
            Backend::start(
                binding,
                options,
                request.url.as_deref(),
                self.root.as_ref().ok_or("BLK-RPA-RUNTIME-001")?,
                slot.cancel.clone(),
            )
        })();
        let mut phase = slot.phase.lock().map_err(|_| "BLK-RPA-STATE-001")?;
        let status = match result {
            Ok(mut backend) => {
                if slot.cancel.load(Ordering::SeqCst) {
                    let settlement = backend.terminate();
                    let result = settlement.clone().and(Err("BLK-RPA-CANCELLED".into()));
                    *phase = Phase::Finished {
                        result,
                        unsettled: settlement.is_err().then_some(backend),
                    };
                    Err(settlement
                        .err()
                        .unwrap_or_else(|| "BLK-RPA-CANCELLED".into()))
                } else {
                    match backend.status() {
                        Ok(status) => {
                            *phase = Phase::Active(backend);
                            Ok(status)
                        }
                        Err(code) => {
                            let settlement = backend.terminate();
                            let code = settlement.clone().err().unwrap_or(code);
                            *phase = Phase::Finished {
                                result: Err(code.clone()),
                                unsettled: settlement.is_err().then_some(backend),
                            };
                            Err(code)
                        }
                    }
                }
            }
            Err(code) => {
                *phase = Phase::Finished {
                    result: Err(code.clone()),
                    unsettled: None,
                };
                Err(code)
            }
        };
        slot.changed.notify_all();
        status
    }
    fn find(&self, project_id: &str, session_id: &str) -> Result<Arc<Slot>, String> {
        self.slot
            .lock()
            .map_err(|_| "BLK-RPA-STATE-001")?
            .as_ref()
            .filter(|slot| slot.session_id == session_id && slot.project_id == project_id)
            .cloned()
            .ok_or("BLK-RPA-STATE-001".into())
    }
    pub fn status(&self, project_id: &str, session_id: &str) -> Result<Value, String> {
        let slot = self.find(project_id, session_id)?;
        let mut phase = slot.phase.lock().map_err(|_| "BLK-RPA-STATE-001")?;
        match &mut *phase {
            Phase::Pending => {
                Ok(json!({"sessionId":session_id,"state":"awaiting-approval","count":0}))
            }
            Phase::Active(backend) => backend.status(),
            Phase::Finished { result, .. } => match result {
                Ok(value) => Ok(
                    json!({"sessionId":session_id,"state":"stopped","count":value.as_ref().and_then(|v|v["actions"].as_array()).map_or(0,Vec::len)}),
                ),
                Err(code) => Err(code.clone()),
            },
        }
    }
    pub fn stop(&self, project_id: &str, session_id: &str) -> Result<Value, String> {
        if [project_id, session_id]
            .iter()
            .any(|id| id.len() > 200 || !crate::project_store::stable(id))
        {
            return Err("BLK-RPA-RECORD-001".into());
        }
        let slot = {
            let mut cancelled = self.cancelled.lock().map_err(|_| "BLK-RPA-STATE-001")?;
            cancelled.retain(|_, expires| *expires > crate::rpa::now());
            let slot = self
                .slot
                .lock()
                .map_err(|_| "BLK-RPA-STATE-001")?
                .as_ref()
                .filter(|slot| slot.project_id == project_id && slot.session_id == session_id)
                .cloned();
            let key = (project_id.to_owned(), session_id.to_owned());
            if cancelled.len() < 64 || cancelled.contains_key(&key) {
                cancelled.insert(key, crate::rpa::now() + 900000);
            } else if slot.is_none() {
                return Err("BLK-RPA-LIMIT-001".into());
            }
            slot
        };
        let Some(slot) = slot else {
            return Ok(
                json!({"sessionId":session_id,"state":"stopped","settled":true,"recording":null}),
            );
        };
        slot.cancel.store(true, Ordering::SeqCst);
        let deadline = Instant::now();
        let mut phase = slot.phase.lock().map_err(|_| "BLK-RPA-STATE-001")?;
        while matches!(*phase, Phase::Pending) {
            let remaining = Duration::from_secs(7)
                .checked_sub(deadline.elapsed())
                .ok_or("BLK-RPA-SETTLEMENT-001")?;
            phase = slot
                .changed
                .wait_timeout(phase, remaining)
                .map_err(|_| "BLK-RPA-STATE-001")?
                .0;
        }
        if let Phase::Active(backend) = &mut *phase {
            let result = backend.stop().map(Some);
            let settlement = if result.is_err() {
                backend.terminate()
            } else {
                Ok(())
            };
            let result = settlement.clone().and(result);
            if settlement.is_ok() {
                *phase = Phase::Finished {
                    result,
                    unsettled: None,
                };
            } else {
                return Err("BLK-RPA-SETTLEMENT-001".into());
            }
        }
        match &mut *phase {
            Phase::Finished { result, unsettled } => {
                if let Some(backend) = unsettled {
                    backend.terminate()?;
                    *unsettled = None;
                }
                match result {
                    Ok(value) => Ok(
                        json!({"sessionId":session_id,"state":"stopped","settled":true,"recording":value}),
                    ),
                    Err(code) if code == "BLK-RPA-CANCELLED" || code == "BLK-RPA-PERM-001" => Ok(
                        json!({"sessionId":session_id,"state":"stopped","settled":true,"recording":null}),
                    ),
                    Err(code) if code != "BLK-RPA-SETTLEMENT-001" => Ok(
                        json!({"sessionId":session_id,"state":"stopped","settled":true,"recording":null,"code":code}),
                    ),
                    Err(code) => Err(code.clone()),
                }
            }
            _ => Err("BLK-RPA-STATE-001".into()),
        }
    }
    pub fn shutdown(&self) -> Result<(), String> {
        self.closing.store(true, Ordering::SeqCst);
        let current = self.slot.lock().map_err(|_| "BLK-RPA-STATE-001")?.clone();
        if let Some(slot) = current {
            if let Err(code) = self.stop(&slot.project_id, &slot.session_id) {
                let settled = matches!(&*slot.phase.lock().map_err(|_|"BLK-RPA-STATE-001")?,Phase::Finished {unsettled:None,result} if !result.as_ref().is_err_and(|code|code=="BLK-RPA-SETTLEMENT-001"));
                if !settled {
                    return Err(code);
                }
            }
        }
        Ok(())
    }
}
