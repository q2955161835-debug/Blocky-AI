mod dns;
pub(crate) use dns::resolve;
use std::net::IpAddr;
const INVALID: &str = "BLK-NETWORK-INVALID";
const LIMIT: &str = "BLK-NETWORK-LIMIT";
const DENIED: &str = "BLK-NETWORK-DENIED";
pub(crate) fn public(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => {
            let b = ip.octets();
            !(ip.is_private()
                || ip.is_loopback()
                || ip.is_link_local()
                || ip.is_broadcast()
                || ip.is_documentation()
                || ip.is_multicast()
                || ip.is_unspecified()
                || b[0] == 0
                || b[0] >= 240
                || b[0] == 127
                || (b[0] == 100 && (64..=127).contains(&b[1]))
                || (b[0] == 192 && b[1] == 0)
                || (b[0] == 198 && (b[1] == 18 || b[1] == 19)))
        }
        IpAddr::V6(ip) => {
            let s = ip.segments();
            (s[0] & 0xe000) == 0x2000
                && !(s[0] == 0x2001 && (s[1] <= 0x1ff || s[1] == 0xdb8))
                && s[0] != 0x2002
                && !(s[0] == 0x3fff && s[1] <= 0x0fff)
        }
    }
}
