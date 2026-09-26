//! Project/patch validation only; these declarations confer no native authorization.
use super::protocol::{Action, InputRef, Plan, Step, TargetRef};
use serde_json::Value;
const SCOPE: &str = "BLK-RPA-SCOPE-001";
fn session(kind: &str) -> bool {
    matches!(kind, "core.computer.attach" | "core.browser.navigate")
}
fn leaf(kind: &str) -> bool {
    matches!(
        kind,
        "core.computer.find"
            | "core.computer.read"
            | "core.computer.act"
            | "core.computer.wait"
            | "core.computer.capture"
            | "core.browser.interact"
            | "core.browser.extract"
    )
}
fn text(value: &Value) -> Result<&str, String> {
    value.as_str().ok_or_else(|| "BLK-RPA-PLAN-001".into())
}
fn child(node: &Value) -> &Value {
    node.get("block")
        .or_else(|| node.get("shadow"))
        .unwrap_or(&Value::Null)
}
pub(crate) fn validate(block: &Value, in_session: bool) -> Result<(), String> {
    let kind = text(&block["type"])?;
    if block["disabled"] != true {
        if leaf(kind) && !in_session {
            return Err(SCOPE.into());
        }
        if session(kind) {
            compile(block)?;
        }
        if let Some(inputs) = block["inputs"].as_object() {
            for (name, input) in inputs {
                let value = child(input);
                if !value.is_null() {
                    validate(value, session(kind) && name == "STEPS")?;
                }
            }
        }
    }
    if !block["next"].is_null() {
        validate(child(&block["next"]), in_session)?;
    }
    Ok(())
}
fn compile(block: &Value) -> Result<(), String> {
    let browser = block["type"] == "core.browser.navigate";
    let mut current = child(&block["inputs"]["STEPS"]);
    let mut steps = Vec::new();
    while !current.is_null() {
        if current["disabled"] == true {
            current = child(&current["next"]);
            continue;
        }
        let kind = text(&current["type"])?;
        if steps.len() >= 100
            || !leaf(kind)
            || kind.starts_with("core.browser.") != browser
            || current["inputs"].as_object().is_some_and(|m| !m.is_empty())
        {
            return Err(SCOPE.into());
        }
        let f = &current["fields"];
        let action = match kind {
            "core.computer.find" => Action::Find,
            "core.computer.read" | "core.browser.extract" => Action::Read,
            "core.computer.wait" => Action::Wait,
            "core.computer.capture" => Action::Screenshot,
            _ => serde_json::from_value(f["ACTION"].clone()).map_err(|_| "BLK-RPA-PLAN-001")?,
        };
        if action == Action::Fill && !["manual", "input", "result"].contains(&text(&f["SOURCE"])?) {
            return Err("BLK-RPA-INPUT-001".into());
        }
        let input_kind = f.get("INPUT_KIND").map(text).transpose()?.unwrap_or("ordinary");
        if !["ordinary", "sensitive"].contains(&input_kind) {
            return Err("BLK-RPA-INPUT-001".into());
        }
        let sensitive = input_kind == "sensitive";
        if sensitive && (action != Action::Fill || f["SOURCE"] != "manual") {
            return Err("BLK-RPA-SENSITIVE-001".into());
        }
        let timeout = text(&f["TIMEOUT_MS"])?;
        if !timeout.bytes().all(|c| c.is_ascii_digit()) {
            return Err("BLK-RPA-PLAN-001".into());
        }
        let id = text(&current["id"])?.to_owned();
        steps.push(Step {
            step_id: id.clone(),
            action,
            locator: serde_json::from_value(f["LOCATOR"].clone())
                .map_err(|_| "BLK-RPA-LOCATOR-001")?,
            timeout_ms: timeout.parse().map_err(|_| "BLK-RPA-PLAN-001")?,
            value: if action == Action::Fill {
                Some(InputRef {
                    kind: "manual-input".into(),
                    reference: None,
                    sensitive: sensitive.then_some(true),
                })
            } else {
                None
            },
            effect_key: if action.effect() { Some(id) } else { None },
        });
        current = child(&current["next"]);
    }
    let identity = if browser {
        let url = text(&block["fields"]["URL"])?;
        let parsed = reqwest::Url::parse(url).map_err(|_| "BLK-RPA-TARGET-001")?;
        if url.len() > 4096
            || !["http", "https"].contains(&parsed.scheme())
            || !parsed.username().is_empty()
            || parsed.password().is_some()
        {
            return Err("BLK-RPA-TARGET-001".into());
        }
        parsed.origin().ascii_serialization()
    } else {
        text(&block["fields"]["TARGET"])?.to_owned()
    };
    Plan {
        schema_version: "blocky.rpa/v1".into(),
        plan_id: text(&block["id"])?.to_owned(),
        target: TargetRef {
            kind: if browser { "browser" } else { "windows" }.into(),
            identity,
        },
        steps,
    }
    .validate()
}
pub(crate) fn permissions(kind: &str, fields: &Value) -> Vec<String> {
    if session(kind) {
        return vec![
            if kind == "core.browser.navigate" {
                "rpa.browser"
            } else {
                "rpa.windows"
            }
            .into(),
        ];
    }
    if !leaf(kind) {
        return vec![];
    }
    let mut values = vec!["rpa.read".into()];
    if fields["ACTION"] == "click" || fields["ACTION"] == "fill" {
        values.push("rpa.write".into());
    }
    if fields["ACTION"] == "fill" {
        values.push("rpa.input".into());
        if fields["INPUT_KIND"] == "sensitive" {
            values.push("rpa.sensitive-input".into());
        }
    }
    if kind == "core.computer.capture" || fields["ACTION"] == "screenshot" {
        values.push("rpa.capture".into());
    }
    if fields["LOCATOR"]["kind"] == "coordinate" {
        values.push("rpa.coordinate".into());
    }
    values
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn scoped_actions_and_permissions() {
        let leaf = json!({"type":"core.browser.interact","id":"fill","fields":{"ACTION":"fill","SOURCE":"manual","TIMEOUT_MS":"1000","LOCATOR":{"kind":"browser","role":"textbox","name":"Answer"}}});
        assert_eq!(validate(&leaf, false).unwrap_err(), SCOPE);
        let mut root = json!({"type":"core.browser.navigate","id":"session","fields":{"URL":"https://example.test/form"},"inputs":{"STEPS":{"block":leaf}}});
        validate(&root, false).unwrap();
        assert_eq!(
            permissions(
                "core.browser.interact",
                &root["inputs"]["STEPS"]["block"]["fields"]
            ),
            vec!["rpa.read", "rpa.write", "rpa.input"]
        );
        root["inputs"]["STEPS"]["block"]["fields"]["LOCATOR"] =
            json!({"kind":"uia","automationId":"answer"});
        assert!(validate(&root, false).is_err());
    }
    #[test]
    fn sensitive_input_cannot_come_from_runtime_data() {
        let mut root = json!({"type":"core.computer.attach","id":"session","fields":{"TARGET":"fixture"},"inputs":{"STEPS":{"block":{"type":"core.computer.act","id":"fill","fields":{"ACTION":"fill","SOURCE":"manual","INPUT_KIND":"sensitive","TIMEOUT_MS":"1000","LOCATOR":{"kind":"uia","automationId":"password"}}}}}});
        validate(&root, false).unwrap();
        assert!(permissions("core.computer.act", &root["inputs"]["STEPS"]["block"]["fields"]).contains(&"rpa.sensitive-input".into()));
        for source in ["input", "result"] {
            root["inputs"]["STEPS"]["block"]["fields"]["SOURCE"] = json!(source);
            assert_eq!(validate(&root, false).unwrap_err(), "BLK-RPA-SENSITIVE-001");
        }
    }
}
