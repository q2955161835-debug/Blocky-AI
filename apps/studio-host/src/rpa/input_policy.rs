//! Input purpose is bound to the approved plan. Confirmation never receives input text.
use super::protocol::{Action, Step};

pub(super) fn sensitive_fill(step: &Step) -> bool {
    step.action == Action::Fill && step.value.as_ref().is_some_and(|input|
        input.kind == "manual-input" && input.sensitive == Some(true))
}
pub(super) fn verify_control(step: &Step, password: bool) -> Result<(), String> {
    if password && !sensitive_fill(step) { Err("BLK-RPA-SENSITIVE-001".into()) } else { Ok(()) }
}
pub(super) fn purpose(step: &Step) -> &'static str {
    if sensitive_fill(step) { "敏感人工输入" } else { "普通人工输入" }
}
pub(super) fn describe(step: &Step) -> String {
    let input = if step.action == Action::Fill { format!("；{}", purpose(step)) } else if step.action == Action::Screenshot { "；遮盖输入区域，本机加密保留 24 小时，可随时删除。其他可见文字会进入图片。".into() } else { String::new() };
    format!("{}：{}{input}", step.action.label(), step.locator.description())
}
pub(super) fn confirmation(target: &str, step: &Step) -> String {
    format!("{target}\n控件：{}\n输入用途：{}\n将填写本次提供的内容，正文不在确认窗口显示。请确认目标、控件及用途。授权仅用于本步骤。", step.locator.description(), purpose(step))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn sensitive_declaration_permits_only_fill_and_confirmation_contains_no_body() {
        let mut step: Step = serde_json::from_value(json!({"stepId":"fill","action":"fill","locator":{"kind":"uia","automationId":"password"},"value":{"kind":"manual-input","sensitive":true},"effectKey":"once"})).unwrap();
        verify_control(&step, true).unwrap();
        assert!(describe(&step).contains("敏感人工输入"));
        let review = confirmation("owned window", &step);
        assert!(review.contains("password") && review.contains("正文不在确认窗口显示"));
        step.action = Action::Read;
        assert_eq!(verify_control(&step, true).unwrap_err(), "BLK-RPA-SENSITIVE-001");
        step.action = Action::Fill; step.value.as_mut().unwrap().sensitive = None;
        assert_eq!(verify_control(&step, true).unwrap_err(), "BLK-RPA-SENSITIVE-001");
        verify_control(&step, false).unwrap();
    }
}
