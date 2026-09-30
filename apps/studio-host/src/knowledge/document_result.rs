//! Untrusted document worker output is checked again before becoming evidence.
use super::*;
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::BTreeMap;
pub const INPUT_LIMIT: usize = 32 * 1024 * 1024;
pub const OUTPUT_LIMIT: usize = 16 * 1024 * 1024;
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ResultData {
    schema_version: String,
    source_digest: String,
    segments: Vec<Segment>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Segment {
    text: String,
    locator: Value,
    metadata: BTreeMap<String, String>,
}
pub fn format(path: &str) -> Option<String> {
    let ext = std::path::Path::new(path)
        .extension()?
        .to_str()?
        .to_ascii_lowercase();
    ["pdf", "docx", "xlsx", "csv", "png", "jpg", "jpeg", "webp"]
        .contains(&ext.as_str())
        .then_some(ext)
}
pub fn locator(value: &Value) -> Result<(), String> {
    let fields = value.as_object().ok_or(INVALID)?;
    for (key, value) in fields {
        match key.as_str() {
            "page" | "paragraph" | "row" => {
                if !value.as_u64().is_some_and(|n| (1..=1000000).contains(&n)) {
                    return Err(INVALID.into());
                }
            }
            "sheet" | "cellRange" => {
                if !value.as_str().is_some_and(|s| {
                    !s.is_empty() && s.len() <= 256 && !s.chars().any(char::is_control)
                }) {
                    return Err(INVALID.into());
                }
            }
            "region" => {
                let region = value.as_object().ok_or(INVALID)?;
                if region.len() != 5 || value["unit"] != "pixel" {
                    return Err(INVALID.into());
                }
                for dimension in ["x", "y", "width", "height"] {
                    if !value[dimension].as_f64().is_some_and(|n| {
                        n.is_finite()
                            && n >= 0.0
                            && n <= 100000.0
                            && (!["width", "height"].contains(&dimension) || n > 0.0)
                    }) {
                        return Err(INVALID.into());
                    }
                }
            }
            _ => return Err(INVALID.into()),
        }
    }
    Ok(())
}
pub fn documents(
    source: &Source,
    relative: &str,
    input: &[u8],
    bytes: &[u8],
) -> Result<Vec<Document>, String> {
    if input.len() > INPUT_LIMIT || bytes.len() > OUTPUT_LIMIT {
        return Err(LIMIT.into());
    }
    let value = crate::strict_json::parse(bytes).map_err(|_| "BLK-DOCUMENT-PROTOCOL")?;
    if value["schemaVersion"] == "blocky.document-error/v1" {
        let code = value["code"].as_str().ok_or("BLK-DOCUMENT-PROTOCOL")?;
        if value.as_object().is_none_or(|v| v.len() != 2)
            || ![
                "BLK-DOCUMENT-FORMAT",
                "BLK-DOCUMENT-ARGUMENT",
                "BLK-DOCUMENT-INVALID",
                "BLK-DOCUMENT-UTF8",
                "BLK-DOCUMENT-LIMIT",
                "BLK-DOCUMENT-CORRUPT",
                "BLK-DOCUMENT-ENCRYPTED",
                "BLK-DOCUMENT-ASSET",
                "BLK-DOCUMENT-EMPTY",
                "BLK-DOCUMENT-IO",
                "BLK-DOCUMENT-UNSAFE",
                "BLK-DOCUMENT-OCR",
            ]
            .contains(&code)
        {
            return Err("BLK-DOCUMENT-PROTOCOL".into());
        }
        return Err(code.into());
    }
    let result: ResultData = serde_json::from_value(value).map_err(|_| "BLK-DOCUMENT-PROTOCOL")?;
    if result.schema_version != "blocky.document-result/v1"
        || result.source_digest != digest(input)
        || result.segments.len() > 10000
    {
        return Err("BLK-DOCUMENT-PROTOCOL".into());
    }
    if result.segments.is_empty() {
        return Err("BLK-DOCUMENT-EMPTY".into());
    }
    let mut total = 0;
    result
        .segments
        .into_iter()
        .enumerate()
        .map(|(index, segment)| {
            cancel::check()?;
            total += segment.text.len();
            if segment.text.trim().is_empty()
                || segment.text.len() > 65536
                || total > 8 * 1024 * 1024
                || segment.metadata.len() > 16
                || segment
                    .metadata
                    .iter()
                    .any(|(k, v)| k.len() > 128 || v.len() > 8192)
            {
                return Err(LIMIT.into());
            }
            locator(&segment.locator)?;
            let mut document = ingest::make_document(source, relative, segment.text.as_bytes())?;
            document.document_id = format!(
                "doc-{}",
                digest(
                    format!(
                        "{}:{relative}:{}:segment:{index}:{}",
                        source.source_id, result.source_digest, segment.locator
                    )
                    .as_bytes()
                )
            );
            for (key, value) in segment.locator.as_object().ok_or(INVALID)? {
                document.locator[key] = value.clone();
            }
            document.format = format(relative).ok_or(INVALID)?;
            for (key, value) in segment.metadata {
                document.metadata[key] = value.into();
            }
            document.metadata["sourceId"] = source.source_id.clone().into();
            document.metadata["sourceDigest"] = result.source_digest.clone().into();
            document.metadata["segment"] = index.to_string().into();
            document.metadata["parser"] = json!("blocky.document-result/v1");
            Ok(document)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    fn source() -> Source {
        Source {
            source_id: "source-test".into(),
            kind: "file".into(),
            title: "public.pdf".into(),
            location: String::new(),
            revision: String::new(),
            allowed_principals: vec!["local-user".into()],
            metadata: json!({}),
        }
    }
    fn result(input: &[u8]) -> Value {
        json!({"schemaVersion":"blocky.document-result/v1","sourceDigest":digest(input),"segments":[{"text":"公开资料：温室里的植物需要阳光。","locator":{"page":2},"metadata":{"method":"pdf-text"}}]})
    }
    #[test]
    fn extracted_segments_keep_locator_and_source_identity_without_raw_paths() {
        let input = b"public document";
        let value = result(input);
        let docs = documents(&source(), "public.pdf", input, value.to_string().as_bytes()).unwrap();
        assert_eq!(docs.len(), 1);
        assert_eq!(docs[0].locator["page"], 2);
        assert_eq!(docs[0].locator["path"], "public.pdf");
        assert_eq!(docs[0].revision, digest(docs[0].text.as_bytes()));
        assert_eq!(docs[0].metadata["sourceDigest"], digest(input));
        let changed_input = b"changed public document";
        let next = documents(
            &source(),
            "public.pdf",
            changed_input,
            result(changed_input).to_string().as_bytes(),
        )
        .unwrap();
        assert_ne!(next[0].document_id, docs[0].document_id);
    }
    #[test]
    fn worker_output_rejects_forged_binding_secret_text_and_invalid_locators() {
        let input = b"public document";
        let original = result(input);
        for key in ["sourceDigest", "schemaVersion"] {
            let mut value = original.clone();
            value[key] = "wrong".into();
            assert!(
                documents(&source(), "public.pdf", input, value.to_string().as_bytes()).is_err()
            );
        }
        for location in [
            json!({"page":0}),
            json!({"path":"C:/private"}),
            json!({"region":{"x":0,"y":0,"width":-1,"height":2,"unit":"pixel"}}),
        ] {
            let mut value = original.clone();
            value["segments"][0]["locator"] = location;
            assert!(
                documents(&source(), "public.pdf", input, value.to_string().as_bytes()).is_err()
            );
        }
        let mut secret = original.clone();
        secret["segments"][0]["text"] = format!("api_key=sk-{}", "synthetic".repeat(4)).into();
        assert_eq!(
            documents(
                &source(),
                "public.pdf",
                input,
                secret.to_string().as_bytes()
            )
            .err()
            .unwrap(),
            "secret-content"
        );
        let mut too_large = original;
        too_large["segments"][0]["text"] = "字".repeat(22000).into();
        assert_eq!(
            documents(
                &source(),
                "public.pdf",
                input,
                too_large.to_string().as_bytes()
            )
            .err()
            .unwrap(),
            LIMIT
        );
    }
}
