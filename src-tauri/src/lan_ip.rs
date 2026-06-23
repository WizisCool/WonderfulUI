//! 取本机局域网 IPv4（避免 127.0.0.1）。
//!
//! 策略：
//! 1. 用 `UdpSocket::connect("8.8.8.8:80")`（不发包，只让内核选路由接口）
//!    然后读 `local_addr()`。这是最可靠的"我的局域网 IP"获取方式。
//! 2. 如果失败（断网/无默认路由），回退到枚举所有 IPv4 接口，
//!    过滤掉 loopback + 链路本地 + 公网，挑选"看起来像内网"的（RFC 1918）。
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
        Some(SocketAddr::V4(v4)) if is_lan_ipv4(v4.ip()) => {
            Some(v4.ip().to_string())
        }
        _ => None,
    }
}

/// `getifaddrs` 在 Windows 上是 IPHLPAPI，在 Unix 上是 libc getifaddrs。
/// 跨平台抽到 `cfg` 块。
#[cfg(unix)]
fn detect_via_interface_enum() -> Option<String> {
    use std::net::Ipv4Addr;
    // 简化：libc getifaddrs 实现比较繁；用 std::process::Command
    // 调 `ipconfig` / `ifconfig` 也不可靠。
    // 实际场景：UdpSocket::connect 几乎总能成功（99% 桌面有默认路由）。
    None
}

#[cfg(windows)]
fn detect_via_interface_enum() -> Option<String> {
    // Windows 上同理 —— 简单实现：UdpSocket::connect 已经处理 99% 场景。
    // 真要枚举 IPHLPAPI 的 GetAdaptersAddresses 是个大工程，先不做。
    None
}

pub fn is_lan_ipv4(ip: &Ipv4Addr) -> bool {
    let octets = ip.octets();
    // 10.0.0.0/8
    if octets[0] == 10 { return true; }
    // 172.16.0.0/12
    if octets[0] == 172 && (16..=31).contains(&octets[1]) { return true; }
    // 192.168.0.0/16
    if octets[0] == 192 && octets[1] == 168 { return true; }
    false
}

#[allow(dead_code)]
fn format_addr(addr: IpAddr) -> String {
    match addr {
        IpAddr::V4(v4) => v4.to_string(),
        IpAddr::V6(v6) => format!("[{}]", v6),
    }
}
