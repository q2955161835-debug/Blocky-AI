use serde_json::Value;
/// Matches the public request protocol's bounded JSON Schema subset.
pub(super) fn matches(value: &Value, schema: &Value, depth: usize) -> bool {
    if depth > 32 {
        return false;
    }
    if schema
        .get("enum")
        .and_then(Value::as_array)
        .is_some_and(|values| !values.contains(value))
    {
        return false;
    }
    match schema["type"].as_str() {
        Some("object") => {
            let Some(object) = value.as_object() else {
                return false;
            };
            if schema
                .get("required")
                .and_then(Value::as_array)
                .is_some_and(|keys| {
                    keys.iter()
                        .any(|key| key.as_str().is_none_or(|key| !object.contains_key(key)))
                })
            {
                return false;
            }
            object
                .iter()
                .all(|(key, value)| match schema["properties"].get(key) {
                    Some(property) => matches(value, property, depth + 1),
                    None => schema["additionalProperties"] != false,
                })
        }
        Some("array") => value.as_array().is_some_and(|items| {
            bounds(items.len() as f64, schema, "minItems", "maxItems")
                && items.iter().all(|item| {
                    schema
                        .get("items")
                        .is_none_or(|rule| matches(item, rule, depth + 1))
                })
        }),
        Some("string") => value
            .as_str()
            .is_some_and(|s| bounds(s.chars().count() as f64, schema, "minLength", "maxLength")),
        Some("integer" | "number") => value.as_f64().is_some_and(|n| {
            n.is_finite()
                && (schema["type"] != "integer" || n.fract() == 0.0)
                && bounds(n, schema, "minimum", "maximum")
        }),
        Some("boolean") => value.is_boolean(),
        Some("null") => value.is_null(),
        _ => false,
    }
}
fn bounds(value: f64, schema: &Value, min: &str, max: &str) -> bool {
    schema[min].as_f64().is_none_or(|n| value >= n)
        && schema[max].as_f64().is_none_or(|n| value <= n)
}
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn provider_structured_output_must_match_types_required_properties_and_bounds() {
        let schema = json!({"type":"object","properties":{"count":{"type":"integer","minimum":1,"maximum":5},"name":{"type":"string","minLength":1}},"required":["count","name"],"additionalProperties":false});
        assert!(matches(&json!({"count":2,"name":"中文"}), &schema, 0));
        for bad in [
            json!({"count":0,"name":"a"}),
            json!({"count":2.5,"name":"a"}),
            json!({"count":2}),
            json!({"count":2,"name":"a","extra":true}),
        ] {
            assert!(!matches(&bad, &schema, 0));
        }
    }
}
