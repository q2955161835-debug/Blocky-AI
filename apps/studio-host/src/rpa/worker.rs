use super::{
    protocol::{Action, Locator, Step},
    target::{self, Target},
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    io::{BufRead, Read, Write},
    time::{Duration, Instant},
};
use uiautomation::{
    UIAutomation, UIElement,
    patterns::{UIInvokePattern, UIValuePattern},
    types::{Handle, TreeScope},
};

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Input {
    #[serde(default)]
    pub coordinate_frame: Option<super::coordinate::Frame>,
    pub target: super::binding::Binding,
    pub root_id: Option<Vec<i32>>,
    pub step: Option<Step>,
    // Private pipe only; never a plan, result, log or CLI argument.
    pub input: Option<String>,
    pub approval: Option<String>,
    pub capture_path: Option<std::path::PathBuf>,
}
fn matches(element: &UIElement, locator: &Locator) -> Result<bool, String> {
    match locator {
        Locator::Uia {
            automation_id,
            name,
            control_type,
        } => {
            if let Some(value) = automation_id {
                if element.get_automation_id().map_err(|_| "BLK-RPA-UIA-001")? != *value {
                    return Ok(false);
                }
            }
            if let Some(value) = name {
                if element.get_name().map_err(|_| "BLK-RPA-UIA-001")? != *value {
                    return Ok(false);
                }
            }
            if let Some(value) = control_type {
                if format!(
                    "{:?}",
                    element.get_control_type().map_err(|_| "BLK-RPA-UIA-001")?
                ) != *value
                {
                    return Ok(false);
                }
            }
            Ok(true)
        }
        _ => Ok(false),
    }
}
fn locate(
    automation: &UIAutomation,
    root: &UIElement,
    target: &Target,
    locator: &Locator,
) -> Result<UIElement, String> {
    let condition = automation
        .create_true_condition()
        .map_err(|_| "BLK-RPA-UIA-001")?;
    let mut stack = vec![(root.clone(), 0)];
    let mut count = 0;
    let mut found = None;
    while let Some((element, depth)) = stack.pop() {
        count += 1;
        if count > 2048 || depth > 32 {
            return Err("BLK-RPA-LIMIT-001".into());
        }
        if element.get_process_id().map_err(|_| "BLK-RPA-UIA-001")? != target.process_id {
            continue;
        }
        if matches(&element, locator)? {
            if found.is_some() {
                return Err("BLK-RPA-LOCATOR-003".into());
            }
            found = Some(element.clone());
        }
        // An empty successful array is the only end-of-branch signal. COM/RPC
        // failures must not turn a partial traversal into a unique match.
        let children = element
            .find_all(TreeScope::Children, &condition)
            .map_err(|_| "BLK-RPA-UIA-001")?;
        if children.len() + count + stack.len() > 2048 {
            return Err("BLK-RPA-LIMIT-001".into());
        }
        stack.extend(children.into_iter().map(|child| (child, depth + 1)));
    }
    found.ok_or_else(|| "BLK-RPA-LOCATOR-004".into())
}
pub(super) fn execute(input: &Input) -> Result<Value, String> {
    match &input.target {
        super::binding::Binding::Windows(target) => target::verify(target)?,
        super::binding::Binding::Browser(target) => target.validate()?,
    }
    if let Some(description) = &input.approval {
        if description.len() > 32768 || input.step.is_some() || input.input.is_some() {
            return Err("BLK-RPA-INPUT-001".into());
        }
        return if super::approval::show(description)? {
            if let Some(frame)=&input.coordinate_frame {super::coordinate_windows::activate(input.target.windows()?,frame)?;}
            Ok(json!({"approved":true}))
        } else {
            Err("BLK-RPA-PERM-001".into())
        };
    }
    let target = input.target.windows()?;
    let automation = UIAutomation::new().map_err(|_| "BLK-RPA-UIA-001")?;
    let root = automation
        .element_from_handle(Handle::from(target.window as isize))
        .map_err(|_| "BLK-RPA-TARGET-001")?;
    let root_id = root.get_runtime_id().map_err(|_| "BLK-RPA-TARGET-001")?;
    if input
        .root_id
        .as_ref()
        .is_some_and(|expected| *expected != root_id)
    {
        return Err("BLK-RPA-TARGET-001".into());
    }
    let Some(step) = &input.step else {
        return Ok(json!({"rootId":root_id}));
    };
    if let Locator::Coordinate{x,y,risk_accepted} = step.locator {
        if step.action!=Action::Click || !risk_accepted || input.input.is_some(){return Err("BLK-RPA-LOCATOR-001".into());}
        super::coordinate_windows::click(target,&automation,&root,&root_id,input.coordinate_frame.as_ref().ok_or(super::coordinate::ERROR)?,(x,y))?;
        return Ok(json!({"clicked":true}));
    }
    if !matches!(step.locator, Locator::Uia { .. }) {
        return Err("BLK-RPA-UNSUPPORTED-001".into());
    }
    let start = Instant::now();
    let element = loop {
        match locate(&automation, &root, target, &step.locator) {
            Ok(element) => break element,
            Err(code)
                if code == "BLK-RPA-LOCATOR-004"
                    && step.action == Action::Wait
                    && start.elapsed() < Duration::from_millis(step.timeout_ms) =>
            {
                std::thread::sleep(Duration::from_millis(50))
            }
            Err(code) => return Err(code),
        }
    };
    target::verify(target)?;
    if root.get_runtime_id().map_err(|_| "BLK-RPA-TARGET-001")? != root_id
        || element.get_process_id().map_err(|_| "BLK-RPA-TARGET-001")? != target.process_id
    {
        return Err("BLK-RPA-TARGET-001".into());
    }
    let password = element.is_password().map_err(|_| "BLK-RPA-SENSITIVE-001")?;
    super::input_policy::verify_control(step, password)?;
    if !element.is_enabled().unwrap_or(false) || element.is_offscreen().unwrap_or(true) {
        return Err("BLK-RPA-TARGET-002".into());
    }
    match step.action {
        Action::Find | Action::Wait => Ok(json!({"found":true})),
        Action::Read => {
            let text = match element.get_pattern::<UIValuePattern>() {
                Ok(pattern) => pattern.get_value().map_err(|_| "BLK-RPA-UIA-001")?,
                Err(_) => element.get_name().map_err(|_| "BLK-RPA-UIA-001")?,
            };
            if text.len() > 16384 {
                return Err("BLK-RPA-LIMIT-001".into());
            }
            // Explicit read result only. The host never puts text into its event/receipt ledger.
            Ok(json!({"text":text}))
        }
        Action::Click => {
            element
                .get_pattern::<UIInvokePattern>()
                .map_err(|_| "BLK-RPA-PATTERN-001")?
                .invoke()
                .map_err(|_| "BLK-RPA-UIA-001")?;
            Ok(json!({"invoked":true}))
        }
        Action::Fill => {
            let text = input.input.as_ref().ok_or("BLK-RPA-INPUT-002")?;
            if text.len() > 16384 || text.contains('\0') {
                return Err("BLK-RPA-INPUT-001".into());
            }
            element
                .get_pattern::<UIValuePattern>()
                .map_err(|_| "BLK-RPA-PATTERN-001")?
                .set_value(text)
                .map_err(|_| "BLK-RPA-UIA-001")?;
            Ok(json!({"filled":true}))
        }
        Action::Screenshot => {
            let masked=super::capture_windows::capture(&automation,&root,&element,target,input.capture_path.as_deref().ok_or("BLK-RPA-CAPTURE-001")?)?;
            Ok(json!({"maskedRegions":masked}))
        },
    }
}
pub fn main() -> i32 {
    let mut line = Vec::new();
    let read = std::io::stdin()
        .lock()
        .take(65537)
        .read_until(b'\n', &mut line);
    if read.is_err() || line.len() > 65536 || line.last() != Some(&b'\n') {
        return 2;
    }
    let result = crate::strict_json::parse(&line)
        .map_err(|_| "BLK-RPA-PLAN-001".to_owned())
        .and_then(|v| serde_json::from_value::<Input>(v).map_err(|_| "BLK-RPA-PLAN-001".to_owned()))
        .and_then(|input| execute(&input));
    let value = match result {
        Ok(value) => json!({"ok":true,"value":value}),
        Err(code) => json!({"ok":false,"code":code}),
    };
    if serde_json::to_writer(std::io::stdout(), &value).is_err() {
        return 2;
    }
    let _ = std::io::stdout().flush();
    0
}
