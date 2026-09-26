//! Input purpose is bound to the approved plan. Confirmation never receives input text.
use super::protocol::{Action, Locator, Step};

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
pub(super) fn describe(step: &Step, target_kind: &str) -> String {
    if matches!(step.locator, Locator::Coordinate { .. }) {
        let units=if target_kind=="windows" {"使用屏幕物理像素，主屏左方或上方显示器坐标可为负。批准后会聚焦所选窗口并移动系统鼠标；请松开所有按键和鼠标按钮，确保目标客户区可见。窗口移动、缩放或遮挡时拒绝。"}else{"以可见页面左上角为原点，单位为 CSS 像素。"};
        return format!("点击：{}；高风险坐标回退，布局变化可能误点。{units}执行前再次确认。", step.locator.description());
    }
    let input = if step.action == Action::Fill { format!("；{}", purpose(step)) } else if step.action == Action::Screenshot { "；遮盖输入区域，本机加密保留 24 小时，可随时删除。其他可见文字会进入图片。".into() } else { String::new() };
    format!("{}：{}{input}", step.action.label(), step.locator.description())
}
pub(super) fn confirmation(target: &str, step: &Step, target_kind: &str) -> String {
    if matches!(step.locator, Locator::Coordinate { .. }) {
        return format!("{target}\n{}\n请核对当前目标，确认继续本次坐标点击。授权仅用于本步骤。", describe(step,target_kind));
    }
    format!("{target}\n控件：{}\n输入用途：{}\n将填写本次提供的内容，正文不在确认窗口显示。请确认目标、控件及用途。授权仅用于本步骤。", step.locator.description(), purpose(step))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn coordinate_review_explains_risk_and_pixel_origin() {
        let step: Step = serde_json::from_value(json!({"stepId":"click","action":"click","locator":{"kind":"coordinate","x":10,"y":20,"riskAccepted":true},"effectKey":"once"})).unwrap();
        let description = describe(&step,"browser");
        assert!(description.contains("高风险") && description.contains("误点"));
        let review = confirmation("isolated browser", &step,"browser");
        assert!(review.contains("10, 20") && review.contains("页面左上角") && review.contains("CSS 像素"));
        assert!(!review.contains("填写"));
        let review = confirmation("owned window", &step,"windows");
        assert!(review.contains("屏幕物理像素") && review.contains("移动系统鼠标") && review.contains("聚焦"));
        assert!(!review.contains("CSS"));
    }
    #[test]
    fn sensitive_declaration_permits_only_fill_and_confirmation_contains_no_body() {
        let mut step: Step = serde_json::from_value(json!({"stepId":"fill","action":"fill","locator":{"kind":"uia","automationId":"password"},"value":{"kind":"manual-input","sensitive":true},"effectKey":"once"})).unwrap();
        verify_control(&step, true).unwrap();
        assert!(describe(&step,"windows").contains("敏感人工输入"));
        let review = confirmation("owned window", &step,"windows");
        assert!(review.contains("password") && review.contains("正文不在确认窗口显示"));
        step.action = Action::Read;
        assert_eq!(verify_control(&step, true).unwrap_err(), "BLK-RPA-SENSITIVE-001");
        step.action = Action::Fill; step.value.as_mut().unwrap().sensitive = None;
        assert_eq!(verify_control(&step, true).unwrap_err(), "BLK-RPA-SENSITIVE-001");
        verify_control(&step, false).unwrap();
    }
}
