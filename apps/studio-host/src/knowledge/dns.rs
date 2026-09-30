pub fn resolve(host: &str, port: u16) -> Result<Vec<std::net::SocketAddr>, String> {
    crate::network_policy::resolve(host, port, &super::cancel::check).map_err(|code| {
        match code.as_str() {
            "BLK-NETWORK-INVALID" => super::INVALID.into(),
            "BLK-NETWORK-LIMIT" => super::LIMIT.into(),
            "BLK-NETWORK-DENIED" => super::DENIED.into(),
            "BLK-NETWORK-TIMEOUT" => "BLK-KNOW-TIMEOUT".into(),
            "BLK-NETWORK-TRANSPORT" => "BLK-KNOW-NETWORK".into(),
            _ => code,
        }
    })
}
