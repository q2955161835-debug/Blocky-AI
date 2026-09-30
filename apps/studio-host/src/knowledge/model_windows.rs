use super::*;
pub fn windows(
    tokenizer: &tokenizers::Tokenizer,
    text: &str,
    prefix: Option<&str>,
    window: usize,
    max_tokens: usize,
) -> Result<Vec<(String, usize)>, String> {
    let encoded = tokenizer
        .encode(text, false)
        .map_err(|_| "BLK-EMBED-TOKENIZE")?;
    let offsets = encoded.get_offsets();
    if offsets.is_empty() {
        return Err(INVALID.into());
    }
    let mut result = Vec::new();
    let mut token_start = 0;
    let mut byte_start = 0;
    while token_start < offsets.len() {
        cancel::check()?;
        let mut token_end = (token_start + window).min(offsets.len());
        loop {
            let byte_end = if token_end == offsets.len() {
                text.len()
            } else {
                offsets[token_end - 1].1
            };
            let fragment = text.get(byte_start..byte_end).ok_or("BLK-EMBED-TOKENIZE")?;
            let input = prefix
                .map(|p| format!("{p}: {fragment}"))
                .unwrap_or_else(|| fragment.to_owned());
            let length = tokenizer
                .encode(input.as_str(), true)
                .map_err(|_| "BLK-EMBED-TOKENIZE")?
                .len();
            if length <= max_tokens && byte_end > byte_start {
                result.push((input, token_end - token_start));
                byte_start = byte_end;
                token_start = token_end;
                break;
            }
            if token_end <= token_start + 1 {
                return Err("BLK-EMBED-TOKENIZE".into());
            }
            token_end -= 1;
        }
    }
    Ok(result)
}
