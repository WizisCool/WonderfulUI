//! 取本机局域网 IPv4（避免 127.0.0.1）。
//!
//! 策略：
//! 1. 用 `UdpSocket::connect("8.8.8.8:80")`（不发包，只让内核选路由接口）
//!    然后读 `local_addr()`。这是最可靠的"我的局域网 IP"获取方式。
//! 2. 如果失败（断网/无默认路由），回退到枚举所有工作中的 IPv4 接口，
//!    过滤掉 loopback + 链路本地 + 公网，选第一个 RFC 1918 地址。
//!
//! **不主动发包**：`UdpSocket::connect` 不会真发 UDP 数据（直到你 `send`）。
//! 不会触发 ACLOS / Riot / Vanguard 任何网络行为。

use std::net::{IpAddr, Ipv4Addr, SocketAddr, UdpSocket};

/// 取一个"看起来像内网"的 IPv4 字符串。失败返回 `None`。
pub fn detect_lan_ipv4() -> Option<String> {
    if let Some(ip) = detect_via_connect() {
        return Some(ip);
    }
    detect_via_interface_enum()
}

fn detect_via_connect() -> Option<String> {
    let sock = UdpSocket::bind("0.0.0.0:0").ok()?;
    // connect 不会真发包；只是让 OS 选出口接口
    sock.connect(("8.8.8.8", 80)).ok()?;
    match sock.local_addr().ok() {
        Some(SocketAddr::V4(v4)) if is_lan_ipv4(v4.ip()) => Some(v4.ip().to_string()),
        _ => None,
    }
}

fn detect_via_interface_enum() -> Option<String> {
    let interfaces = if_addrs::get_if_addrs().ok()?;
    first_lan_ipv4(interfaces.into_iter().filter_map(|interface| {
        if !interface.is_oper_up() || interface.is_loopback() || interface.is_link_local() {
            return None;
        }
        match interface.ip() {
            IpAddr::V4(ip) => Some(ip),
            IpAddr::V6(_) => None,
        }
    }))
    .map(|ip| ip.to_string())
}

fn first_lan_ipv4(candidates: impl IntoIterator<Item = Ipv4Addr>) -> Option<Ipv4Addr> {
    candidates.into_iter().find(is_lan_ipv4)
}

pub fn is_lan_ipv4(ip: &Ipv4Addr) -> bool {
    let octets = ip.octets();
    // 10.0.0.0/8
    if octets[0] == 10 {
        return true;
    }
    // 172.16.0.0/12
    if octets[0] == 172 && (16..=31).contains(&octets[1]) {
        return true;
    }
    // 192.168.0.0/16
    if octets[0] == 192 && octets[1] == 168 {
        return true;
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn private_ipv4_classification_covers_all_rfc1918_ranges() {
        for accepted in ["10.0.0.1", "172.16.5.5", "172.31.255.254", "192.168.1.1"] {
            assert!(is_lan_ipv4(&accepted.parse().unwrap()), "{accepted}");
        }
        for rejected in ["127.0.0.1", "169.254.1.2", "8.8.8.8", "172.32.0.1"] {
            assert!(!is_lan_ipv4(&rejected.parse().unwrap()), "{rejected}");
        }
    }

    #[test]
    fn interface_fallback_skips_non_lan_addresses_without_reordering() {
        let selected = first_lan_ipv4([
            "127.0.0.1".parse().unwrap(),
            "8.8.8.8".parse().unwrap(),
            "10.42.0.7".parse().unwrap(),
            "192.168.1.5".parse().unwrap(),
        ]);
        assert_eq!(selected, Some("10.42.0.7".parse().unwrap()));
    }
}
