use super::{
    process::{RecordingProcess, validate_status},
    protocol::{Options, validate_result},
};
use crate::rpa::{binding::Binding, ipc::PipeProcess};
use serde_json::{Value, json};
use std::{
    path::Path,
    sync::{Arc, atomic::AtomicBool},
};
pub(super) enum Backend {
    Windows(RecordingProcess),
    Browser {
        process: PipeProcess,
        options: Options,
    },
}
impl Backend {
    pub fn start(
        binding: Binding,
        options: Options,
        url: Option<&str>,
        root: &Path,
        cancel: Arc<AtomicBool>,
    ) -> Result<Self, String> {
        match binding {
            Binding::Windows(target) => {
                RecordingProcess::start(target, options, cancel).map(Self::Windows)
            }
            Binding::Browser(target) => {
                let mut process = crate::rpa::browser::start(root, cancel.clone())?;
                let initialized = (|| {
                    let actual=process.request(json!({"kind":"open","projectId":target.project_id,"url":url.ok_or("BLK-RPA-TARGET-001")?,"identity":target.identity}),15000,cancel.clone())?;
                    if serde_json::from_value::<crate::rpa::binding::BrowserTarget>(actual)
                        .map_err(|_| "BLK-RPA-WIRE-001")?
                        != target
                    {
                        return Err("BLK-RPA-WIRE-001".into());
                    }
                    let status=process.request(json!({"kind":"record-start","identity":target.identity,"projectId":target.project_id,"sessionId":options.session_id}),5000,cancel)?;
                    validate_status(&status, &options)
                })();
                if let Err(code) = initialized {
                    process.terminate()?;
                    return Err(code);
                }
                Ok(Self::Browser { process, options })
            }
        }
    }
    pub fn status(&mut self) -> Result<Value, String> {
        let cancel = Arc::new(AtomicBool::new(false));
        match self {
            Self::Windows(process) => process.status(cancel),
            Self::Browser { process, options } => {
                let value=process.request(json!({"kind":"record-status","identity":options.target.identity,"sessionId":options.session_id}),3000,cancel)?;
                if let Err(code) = validate_status(&value, options) {
                    process.terminate()?;
                    return Err(code);
                }
                Ok(value)
            }
        }
    }
    pub fn stop(&mut self) -> Result<Value, String> {
        match self {
            Self::Windows(process) => process.stop(),
            Self::Browser { process, options } => {
                let result=process.request(json!({"kind":"record-stop","identity":options.target.identity,"sessionId":options.session_id}),5000,Arc::new(AtomicBool::new(false)));
                process.shutdown()?;
                let value = result?;
                validate_result(&value, options)?;
                Ok(value)
            }
        }
    }
    pub fn terminate(&mut self) -> Result<(), String> {
        match self {
            Self::Windows(process) => process.terminate(),
            Self::Browser { process, .. } => process.terminate(),
        }
    }
}
