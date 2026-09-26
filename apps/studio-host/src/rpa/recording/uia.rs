//! Owned MTA worker only. UIA callbacks read identity metadata, never Value/Text patterns.
use super::protocol::{CapturedAction, Options, RecordingBuffer};
use crate::rpa::{
    protocol::{Action, Locator},
    target::{self, Target},
};
use serde_json::Value;
use std::{
    collections::HashMap,
    sync::{
        Arc,
        atomic::{AtomicBool, AtomicU32, Ordering},
        mpsc::{Receiver, sync_channel},
    },
};
use uiautomation::{
    UIAutomation, UIElement,
    events::{CustomEventHandlerFn, UIEventHandler, UIEventType},
    types::{Handle, TreeScope},
};

pub struct Capture {
    automation: UIAutomation,
    root: UIElement,
    root_id: Vec<i32>,
    target: Target,
    handler: UIEventHandler,
    active: Arc<AtomicBool>,
    overflow: Arc<AtomicU32>,
    events: Receiver<(Vec<i32>, Action)>,
    catalog: HashMap<Vec<i32>, CapturedAction>,
    buffer: RecordingBuffer,
    stopped: Option<Value>,
}
const EVENTS: [UIEventType; 2] = [UIEventType::Invoke_Invoked, UIEventType::Text_TextChanged];
fn catalog(
    automation: &UIAutomation,
    root: &UIElement,
    target: &Target,
) -> Result<HashMap<Vec<i32>, CapturedAction>, String> {
    let condition = automation
        .create_true_condition()
        .map_err(|_| "BLK-RPA-UIA-001")?;
    let mut pending = vec![(root.clone(), 0usize)];
    let mut seen = 0;
    let mut result = HashMap::new();
    while let Some((element, depth)) = pending.pop() {
        seen += 1;
        if seen > 2048 || depth > 32 {
            return Err("BLK-RPA-LIMIT-001".into());
        }
        if element.get_process_id().map_err(|_| "BLK-RPA-UIA-001")? != target.process_id {
            continue;
        }
        let runtime = element.get_runtime_id().map_err(|_| "BLK-RPA-UIA-001")?;
        let control_type = format!(
            "{:?}",
            element.get_control_type().map_err(|_| "BLK-RPA-UIA-001")?
        );
        let automation_id = element.get_automation_id().map_err(|_| "BLK-RPA-UIA-001")?;
        // Prefer stable IDs and omit display names when an ID is available.
        let name = if automation_id.is_empty() {
            Some(element.get_name().map_err(|_| "BLK-RPA-UIA-001")?)
        } else {
            None
        };
        let captured = CapturedAction {
            action: Action::Click,
            locator: Locator::Uia {
                automation_id: (!automation_id.is_empty()).then_some(automation_id),
                name,
                control_type: Some(control_type),
            },
            sensitive: Some(element.is_password().map_err(|_| "BLK-RPA-UIA-001")?),
        };
        if !runtime.is_empty() && runtime.len() <= 64 && captured.validate("windows").is_ok() {
            if result.insert(runtime, captured).is_some() {
                return Err("BLK-RPA-LOCATOR-003".into());
            }
        }
        let children = element
            .find_all(TreeScope::Children, &condition)
            .map_err(|_| "BLK-RPA-UIA-001")?;
        if children.len() + pending.len() + seen > 2048 {
            return Err("BLK-RPA-LIMIT-001".into());
        }
        pending.extend(children.into_iter().map(|child| (child, depth + 1)));
    }
    Ok(result)
}
impl Capture {
    pub fn start(target: Target, options: Options) -> Result<Self, String> {
        options.validate()?;
        if options.target.kind != "windows" || options.target.identity != target.identity {
            return Err("BLK-RPA-TARGET-001".into());
        }
        target::verify(&target)?;
        let automation = UIAutomation::new().map_err(|_| "BLK-RPA-UIA-001")?;
        let root = automation
            .element_from_handle(Handle::from(target.window as isize))
            .map_err(|_| "BLK-RPA-TARGET-001")?;
        let root_id = root.get_runtime_id().map_err(|_| "BLK-RPA-TARGET-001")?;
        let catalog = catalog(&automation, &root, &target)?;
        let buffer = RecordingBuffer::new(
            serde_json::to_value(options).map_err(|_| "BLK-RPA-RECORD-001")?,
            crate::rpa::now(),
        )?;
        let active = Arc::new(AtomicBool::new(true));
        let overflow = Arc::new(AtomicU32::new(0));
        let (sender, events) = sync_channel(32);
        let live = active.clone();
        let dropped = overflow.clone();
        let pid = target.process_id;
        let callback: Box<CustomEventHandlerFn> = Box::new(move |element, event| {
            if !live.load(Ordering::SeqCst) {
                return Ok(());
            }
            let action = if event == UIEventType::Invoke_Invoked {
                Action::Click
            } else if event == UIEventType::Text_TextChanged {
                Action::Fill
            } else {
                return Ok(());
            };
            let identity = element.get_runtime_id();
            let process = element.get_process_id();
            if !live.load(Ordering::SeqCst) {
                return Ok(());
            }
            let sent = match (identity, process) {
                (Ok(identity), Ok(process))
                    if process == pid && !identity.is_empty() && identity.len() <= 64 =>
                {
                    sender.try_send((identity, action)).is_ok()
                }
                _ => false,
            };
            if !sent {
                let _ = dropped.fetch_update(Ordering::SeqCst, Ordering::SeqCst, |n| {
                    Some((n + 1).min(10000))
                });
            }
            Ok(())
        });
        let handler = UIEventHandler::from(callback);
        let capture = Self {
            automation,
            root,
            root_id,
            target,
            handler,
            active,
            overflow,
            events,
            catalog,
            buffer,
            stopped: None,
        };
        for (i, event) in EVENTS.iter().enumerate() {
            if capture
                .automation
                .add_automation_event_handler(
                    *event,
                    &capture.root,
                    TreeScope::Subtree,
                    None,
                    &capture.handler,
                )
                .is_err()
            {
                capture.active.store(false, Ordering::SeqCst);
                for previous in &EVENTS[..i] {
                    let _ = capture.automation.remove_automation_event_handler(
                        *previous,
                        &capture.root,
                        &capture.handler,
                    );
                }
                return Err("BLK-RPA-UIA-001".into());
            }
        }
        Ok(capture)
    }
    fn drain(&mut self) {
        for _ in 0..self.overflow.swap(0, Ordering::SeqCst).min(10000) {
            self.buffer.omit();
        }
        for (identity, action) in self.events.try_iter() {
            let Some(mut metadata) = self.catalog.get(&identity).cloned() else {
                self.buffer.omit();
                continue;
            };
            metadata.action = action;
            self.buffer.append(
                serde_json::to_value(metadata).unwrap_or(Value::Null),
                crate::rpa::now(),
            );
        }
    }
    pub fn status(&mut self) -> Result<Value, String> {
        if self.stopped.is_none() {
            if target::verify(&self.target).is_err()
                || self.root.get_runtime_id().ok().as_ref() != Some(&self.root_id)
            {
                self.stop("target-lost")?;
            } else {
                self.drain();
                let status = self.buffer.status(crate::rpa::now())?;
                if status["state"] == "stopped" {
                    self.stop(status["reason"].as_str().ok_or("BLK-RPA-RECORD-001")?)?;
                }
            }
        }
        self.buffer.status(crate::rpa::now())
    }
    pub fn stop(&mut self, reason: &str) -> Result<Value, String> {
        if let Some(result) = &self.stopped {
            return Ok(result.clone());
        }
        self.active.store(false, Ordering::SeqCst);
        let mut failed = false;
        for event in EVENTS {
            if self
                .automation
                .remove_automation_event_handler(event, &self.root, &self.handler)
                .is_err()
            {
                failed = true;
            }
        }
        if failed {
            return Err("BLK-RPA-SETTLEMENT-001".into());
        }
        self.drain();
        let result = self.buffer.seal(reason, crate::rpa::now())?;
        self.catalog.clear();
        self.stopped = Some(result.clone());
        Ok(result)
    }
}
impl Drop for Capture {
    fn drop(&mut self) {
        self.active.store(false, Ordering::SeqCst);
        if self.stopped.is_none() {
            for event in EVENTS {
                let _ = self.automation.remove_automation_event_handler(
                    event,
                    &self.root,
                    &self.handler,
                );
            }
        }
    }
}
