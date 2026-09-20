use serde_json::Value;
use std::sync::OnceLock;
pub(super) fn credentials(value: &Value) -> bool {
    static PATTERNS: OnceLock<Vec<regex::Regex>> = OnceLock::new();
    let patterns = PATTERNS.get_or_init(|| {
        serde_json::from_str::<Vec<String>>(include_str!(
            "../../../../packages/language-schema/src/credential-patterns.json"
        ))
        .expect("locked patterns")
        .iter()
        .map(|s| {
            regex::RegexBuilder::new(s)
                .case_insensitive(true)
                .build()
                .expect("locked pattern")
        })
        .collect()
    });
    match value {
        Value::String(s) => patterns.iter().any(|p| p.is_match(s)),
        Value::Array(a) => a.iter().any(credentials),
        Value::Object(o) => o.values().any(credentials),
        _ => false,
    }
}
