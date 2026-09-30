use reqwest::Url;
use std::net::IpAddr;
const ERROR: &str = "BLK-MODEL-ENDPOINT";
/// Local adapters only accept literal loopback. Remote adapters require public DNS.
/// Address resolution is checked and pinned separately before each connection.
pub fn validate_endpoint(input: &str, local: bool) -> Result<Url, String> {
    let lowered = input.to_ascii_lowercase();
    if input.len() > 2048
        || input
            .bytes()
            .any(|b| b.is_ascii_whitespace() || b < 32 || b == b'\\')
        || ["/../", "/./", "%2e", "%2f", "%5c"]
            .iter()
            .any(|v| lowered.contains(v))
    {
        return Err(ERROR.into());
    }
    let url = Url::parse(input).map_err(|_| ERROR)?;
    if !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(ERROR.into());
    }
    let host = url.host_str().ok_or(ERROR)?.trim_matches(['[', ']']);
    if local {
        if url.scheme() != "http"
            || !["127.0.0.1", "::1"].contains(&host)
            || url.port().is_none_or(|n| n == 0)
        {
            return Err(ERROR.into());
        }
    } else if url.scheme() != "https"
        || host.parse::<IpAddr>().is_ok()
        || !host.contains('.')
        || host.ends_with('.')
        || host.split('.').any(|label| {
            label.is_empty()
                || label == "localhost"
                || label.starts_with('-')
                || label.ends_with('-')
                || !label
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'-')
        })
        || [
            ".local",
            ".internal",
            ".lan",
            ".home",
            ".localhost",
            ".test",
            ".invalid",
        ]
        .iter()
        .any(|s| host.ends_with(s))
    {
        return Err(ERROR.into());
    }
    Ok(url)
}
