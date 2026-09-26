use super::BrowserProcess;
use crate::rpa::binding::BrowserTarget;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
};
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BrowserStart {
    pub project_id: String,
    pub url: String,
}
impl BrowserStart {
    pub fn prepare(&self, plan: &mut crate::rpa::protocol::Plan) -> Result<BrowserTarget, String> {
        plan.validate()?;
        let url = reqwest::Url::parse(&self.url).map_err(|_| "BLK-RPA-TARGET-001")?;
        if self.url.len() > 4096
            || !["http", "https"].contains(&url.scheme())
            || !url.username().is_empty()
            || url.password().is_some()
            || plan.target.kind != "browser"
            || plan.target.identity != url.origin().ascii_serialization()
        {
            return Err("BLK-RPA-TARGET-001".into());
        }
        let target = BrowserTarget {
            identity: format!("browser:{}", uuid::Uuid::new_v4()),
            project_id: self.project_id.clone(),
            origin: url.origin().ascii_serialization(),
        };
        target.validate()?;
        plan.target.identity = target.identity.clone();
        Ok(target)
    }
}
struct Slot {
    target: BrowserTarget,
    process: Mutex<BrowserProcess>,
}
#[derive(Default)]
pub(in crate::rpa) struct Manager {
    root: Option<PathBuf>,
    slots: Mutex<HashMap<String, Arc<Slot>>>,
    opening: Mutex<usize>,
    closing: AtomicBool,
}
impl Manager {
    pub fn new(root: PathBuf) -> Self {
        Self {
            root: Some(root),
            ..Self::default()
        }
    }
    pub fn open(
        &self,
        target: &BrowserTarget,
        url: &str,
        cancel: Arc<AtomicBool>,
    ) -> Result<(), String> {
        {
            let mut pending = self.opening.lock().map_err(|_| "BLK-RPA-STATE-001")?;
            if self.closing.load(Ordering::SeqCst)
                || *pending + self.slots.lock().map_err(|_| "BLK-RPA-STATE-001")?.len() >= 4
            {
                return Err("BLK-RPA-LIMIT-001".into());
            }
            *pending += 1;
        }
        let result = (|| {
            let mut process = super::process::start(
                self.root.as_ref().ok_or("BLK-RPA-RUNTIME-001")?,
                cancel.clone(),
            )?;
            let opened=process.request(json!({"kind":"open","projectId":target.project_id,"url":url,"identity":target.identity}),15000,cancel.clone())
                .and_then(|actual|serde_json::from_value::<BrowserTarget>(actual).map_err(|_|"BLK-RPA-WIRE-001".into()));
            let mut slots = self.slots.lock().map_err(|_| "BLK-RPA-STATE-001")?;
            let failure = match opened {
                Ok(actual)
                    if actual == *target
                        && !cancel.load(Ordering::SeqCst)
                        && !self.closing.load(Ordering::SeqCst) =>
                {
                    None
                }
                Ok(_) => Some("BLK-RPA-CANCELLED".to_owned()),
                Err(code) => Some(code),
            };
            if let Some(code) = failure {
                if let Err(error) = process.shutdown() {
                    slots.insert(
                        target.identity.clone(),
                        Arc::new(Slot {
                            target: target.clone(),
                            process: Mutex::new(process),
                        }),
                    );
                    return Err(error);
                }
                return Err(code);
            }
            slots.insert(
                target.identity.clone(),
                Arc::new(Slot {
                    target: target.clone(),
                    process: Mutex::new(process),
                }),
            );
            Ok(())
        })();
        *self.opening.lock().map_err(|_| "BLK-RPA-STATE-001")? -= 1;
        result
    }
    pub fn request(
        &self,
        target: &BrowserTarget,
        value: Value,
        timeout: u64,
        cancel: Arc<AtomicBool>,
    ) -> Result<Value, String> {
        let slot = self
            .slots
            .lock()
            .map_err(|_| "BLK-RPA-STATE-001")?
            .get(&target.identity)
            .cloned()
            .ok_or("BLK-RPA-TARGET-001")?;
        if slot.target != *target {
            return Err("BLK-RPA-TARGET-001".into());
        }
        // Operations for different browser sessions use different process locks and Jobs.
        let mut process = slot.process.try_lock().map_err(|_| "BLK-RPA-STATE-001")?;
        process.request(value, timeout, cancel)
    }
    pub fn verify(&self, target: &BrowserTarget) -> Result<(), String> {
        let actual = self.request(
            target,
            json!({"kind":"inspect","identity":target.identity}),
            1000,
            Arc::new(AtomicBool::new(false)),
        )?;
        if serde_json::from_value::<BrowserTarget>(actual).map_err(|_| "BLK-RPA-WIRE-001")?
            != *target
        {
            return Err("BLK-RPA-TARGET-001".into());
        }
        Ok(())
    }
    pub fn capture(&self,target:&BrowserTarget,request:Value,timeout:u64,cancel:Arc<AtomicBool>)->Result<(Vec<u8>,u32),String> {
        let slot=self.slots.lock().map_err(|_|"BLK-RPA-STATE-001")?.get(&target.identity).cloned().ok_or("BLK-RPA-TARGET-001")?;
        if slot.target!=*target{return Err("BLK-RPA-TARGET-001".into());}
        let mut process=slot.process.try_lock().map_err(|_|"BLK-RPA-STATE-001")?;
        let result=super::capture::receive(&mut process,request,timeout,cancel);
        if result.is_err(){process.shutdown()?;}
        result
    }
    pub fn close(&self, target: &BrowserTarget) -> Result<(), String> {
        let slot = self
            .slots
            .lock()
            .map_err(|_| "BLK-RPA-STATE-001")?
            .get(&target.identity)
            .cloned();
        if let Some(slot) = slot {
            slot.process
                .try_lock()
                .map_err(|_| "BLK-RPA-SETTLEMENT-001")?
                .shutdown()?;
            self.slots
                .lock()
                .map_err(|_| "BLK-RPA-STATE-001")?
                .remove(&target.identity);
        }
        Ok(())
    }
    pub fn shutdown(&self) -> Result<(), String> {
        self.closing.store(true, Ordering::SeqCst);
        let targets = self
            .slots
            .lock()
            .map_err(|_| "BLK-RPA-STATE-001")?
            .values()
            .map(|s| s.target.clone())
            .collect::<Vec<_>>();
        let mut failed = None;
        for target in targets {
            if let Err(error) = self.close(&target) {
                failed.get_or_insert(error);
            }
        }
        if let Some(error) = failed {
            Err(error)
        } else {
            Ok(())
        }
    }
}
