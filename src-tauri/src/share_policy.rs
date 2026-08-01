//! Shared policy constants and stable IPC error codes for Quick Share.

/// Quick Share deliberately uses one documented TCP port so the Windows
/// firewall rule can be narrow enough to be useful without opening every port
/// owned by the application.
pub const QUICK_SHARE_PORT: u16 = 22_357;
pub const QUICK_SHARE_PORT_TEXT: &str = "22357";

pub const QUICK_SHARE_FIREWALL_RULE_NAME: &str = "WonderfulUI Quick Share";
pub const QUICK_SHARE_FIREWALL_GROUP: &str = "WonderfulUI";
pub const QUICK_SHARE_FIREWALL_REMOTE_ADDRESSES: &str = "LocalSubnet";
pub const FIREWALL_HELPER_ARGUMENT: &str = "--wui-firewall-helper";

pub const FIREWALL_PROFILE_DOMAIN_PRIVATE_PUBLIC: i32 = 1 | 2 | 4;
pub const FIREWALL_PROFILE_ALL: i32 = i32::MAX;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FirewallRuleSnapshot {
    pub name: String,
    pub group: String,
    pub application_name: String,
    pub enabled: bool,
    pub inbound: bool,
    pub allow: bool,
    pub tcp: bool,
    pub local_ports: String,
    pub profiles: i32,
    pub remote_addresses: String,
    pub edge_traversal: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FirewallPolicyState {
    Ok,
    GroupPolicyOverride,
    InboundBlocked,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FirewallDecision {
    Ready,
    Repair,
    PolicyManaged,
    InboundBlocked,
}

pub fn firewall_rule_matches(
    rule: Option<&FirewallRuleSnapshot>,
    expected_application_name: &str,
) -> bool {
    let Some(rule) = rule else { return false };
    rule.name == QUICK_SHARE_FIREWALL_RULE_NAME
        && rule.group == QUICK_SHARE_FIREWALL_GROUP
        && rule.application_name == expected_application_name
        && rule.enabled
        && rule.inbound
        && rule.allow
        && rule.tcp
        && rule.local_ports == QUICK_SHARE_PORT_TEXT
        && (rule.profiles == FIREWALL_PROFILE_DOMAIN_PRIVATE_PUBLIC
            || rule.profiles == FIREWALL_PROFILE_ALL)
        && rule
            .remote_addresses
            .eq_ignore_ascii_case(QUICK_SHARE_FIREWALL_REMOTE_ADDRESSES)
        && !rule.edge_traversal
}

pub fn firewall_decision(
    rule: Option<&FirewallRuleSnapshot>,
    expected_application_name: &str,
    policy_state: FirewallPolicyState,
) -> FirewallDecision {
    if firewall_rule_matches(rule, expected_application_name) {
        return FirewallDecision::Ready;
    }
    match policy_state {
        FirewallPolicyState::Ok => FirewallDecision::Repair,
        FirewallPolicyState::GroupPolicyOverride => FirewallDecision::PolicyManaged,
        FirewallPolicyState::InboundBlocked => FirewallDecision::InboundBlocked,
    }
}

/// Error identifiers are part of the renderer/backend contract. The text
/// after the `|` is intentionally user-safe; implementation details go to
/// the application log instead.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ShareErrorCode {
    SourceUnavailable,
    PortInUse,
    PortBindFailed,
    LanIpUnavailable,
    #[cfg(windows)]
    FirewallPolicyManaged,
    #[cfg(windows)]
    FirewallInboundBlocked,
    #[cfg(windows)]
    FirewallAuthorizationCancelled,
    #[cfg(windows)]
    FirewallAuthorizationFailed,
    StartCancelled,
    ServerStartFailed,
}

impl ShareErrorCode {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::SourceUnavailable => "WUI_SHARE_SOURCE_UNAVAILABLE",
            Self::PortInUse => "WUI_SHARE_PORT_IN_USE",
            Self::PortBindFailed => "WUI_SHARE_PORT_BIND_FAILED",
            Self::LanIpUnavailable => "WUI_SHARE_LAN_IP_UNAVAILABLE",
            #[cfg(windows)]
            Self::FirewallPolicyManaged => "WUI_SHARE_FIREWALL_POLICY_MANAGED",
            #[cfg(windows)]
            Self::FirewallInboundBlocked => "WUI_SHARE_FIREWALL_INBOUND_BLOCKED",
            #[cfg(windows)]
            Self::FirewallAuthorizationCancelled => "WUI_SHARE_FIREWALL_AUTHORIZATION_CANCELLED",
            #[cfg(windows)]
            Self::FirewallAuthorizationFailed => "WUI_SHARE_FIREWALL_AUTHORIZATION_FAILED",
            Self::StartCancelled => "WUI_SHARE_START_CANCELLED",
            Self::ServerStartFailed => "WUI_SHARE_SERVER_START_FAILED",
        }
    }

    pub const fn user_message(self) -> &'static str {
        match self {
            Self::SourceUnavailable => "快传源文件不可用，请重新扫描后重试。",
            Self::PortInUse => "快传端口 22357 被占用，请关闭占用该端口的程序后重试。",
            Self::PortBindFailed => "快传无法监听端口 22357，请稍后重试。",
            Self::LanIpUnavailable => "未检测到可供其他设备访问的局域网 IPv4 地址。",
            #[cfg(windows)]
            Self::FirewallPolicyManaged => "Windows 防火墙规则受组织策略管理，请联系管理员。",
            #[cfg(windows)]
            Self::FirewallInboundBlocked => {
                "当前 Windows 入站策略禁止连接，请允许局域网入站后重试。"
            }
            #[cfg(windows)]
            Self::FirewallAuthorizationCancelled => "需要允许 Windows 管理员授权才能开启快传。",
            #[cfg(windows)]
            Self::FirewallAuthorizationFailed => "Windows 防火墙授权失败，请稍后重试或联系管理员。",
            Self::StartCancelled => "快传启动已取消。",
            Self::ServerStartFailed => "快传服务启动失败，请稍后重试。",
        }
    }
}

pub fn ipc_error(code: ShareErrorCode) -> String {
    format!("{}|{}", code.as_str(), code.user_message())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn correct_rule() -> FirewallRuleSnapshot {
        FirewallRuleSnapshot {
            name: QUICK_SHARE_FIREWALL_RULE_NAME.into(),
            group: QUICK_SHARE_FIREWALL_GROUP.into(),
            application_name: "c:\\program files\\wonderfului\\wonderful-ui.exe".into(),
            enabled: true,
            inbound: true,
            allow: true,
            tcp: true,
            local_ports: QUICK_SHARE_PORT_TEXT.into(),
            profiles: FIREWALL_PROFILE_DOMAIN_PRIVATE_PUBLIC,
            remote_addresses: QUICK_SHARE_FIREWALL_REMOTE_ADDRESSES.into(),
            edge_traversal: false,
        }
    }

    #[test]
    fn correct_rule_does_not_request_repair() {
        let rule = correct_rule();
        assert_eq!(
            firewall_decision(
                Some(&rule),
                "c:\\program files\\wonderfului\\wonderful-ui.exe",
                FirewallPolicyState::Ok,
            ),
            FirewallDecision::Ready
        );
    }

    #[test]
    fn missing_or_wrong_rule_requests_repair() {
        let mut rule = correct_rule();
        for wrong in [
            FirewallRuleSnapshot {
                name: "wrong name".into(),
                ..rule.clone()
            },
            FirewallRuleSnapshot {
                application_name: "c:\\other\\wonderful-ui.exe".into(),
                ..rule.clone()
            },
            FirewallRuleSnapshot {
                tcp: false,
                ..rule.clone()
            },
            FirewallRuleSnapshot {
                local_ports: "53124".into(),
                ..rule.clone()
            },
        ] {
            assert_eq!(
                firewall_decision(
                    Some(&wrong),
                    "c:\\program files\\wonderfului\\wonderful-ui.exe",
                    FirewallPolicyState::Ok,
                ),
                FirewallDecision::Repair
            );
        }
        rule.edge_traversal = true;
        assert_eq!(
            firewall_decision(
                Some(&rule),
                "c:\\program files\\wonderfului\\wonderful-ui.exe",
                FirewallPolicyState::Ok,
            ),
            FirewallDecision::Repair
        );
        assert_eq!(
            firewall_decision(
                None,
                "c:\\program files\\wonderfului\\wonderful-ui.exe",
                FirewallPolicyState::Ok,
            ),
            FirewallDecision::Repair
        );
    }

    #[test]
    fn managed_policy_states_never_silently_fall_back_to_an_unscoped_rule() {
        let rule = correct_rule();
        assert_eq!(
            firewall_decision(
                Some(&FirewallRuleSnapshot {
                    local_ports: "53124".into(),
                    ..rule.clone()
                }),
                "c:\\program files\\wonderfului\\wonderful-ui.exe",
                FirewallPolicyState::GroupPolicyOverride,
            ),
            FirewallDecision::PolicyManaged
        );
        assert_eq!(
            firewall_decision(
                None,
                "c:\\program files\\wonderfului\\wonderful-ui.exe",
                FirewallPolicyState::InboundBlocked,
            ),
            FirewallDecision::InboundBlocked
        );
    }
}
