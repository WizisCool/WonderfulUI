//! Windows Defender Firewall authorization for Quick Share.
//!
//! The runtime path uses the Windows Firewall COM API for inspection and
//! repair. A repair is performed by the same signed executable in a fixed
//! helper mode, launched with `runas`; no renderer-controlled command, path,
//! port, or shell text crosses the elevation boundary.

#![allow(dead_code)]

use crate::share_policy::FIREWALL_HELPER_ARGUMENT;

pub fn helper_args_are_exact(args: &[String]) -> bool {
    args.len() == 2 && args[1] == FIREWALL_HELPER_ARGUMENT
}

pub fn ensure_ready() -> Result<(), String> {
    #[cfg(windows)]
    {
        return windows::ensure_ready();
    }

    #[cfg(not(windows))]
    {
        // macOS/Linux builds do not own a Windows firewall and must keep the
        // backend testable without side effects.
        Ok(())
    }
}

/// Returns `Some(exit_code)` only for the exact internal helper invocation.
/// The caller must exit before initializing Tauri so the helper cannot open a
/// normal UI process or register renderer commands.
pub fn run_helper_if_requested() -> Option<i32> {
    #[cfg(windows)]
    {
        return windows::run_helper_if_requested();
    }

    #[cfg(not(windows))]
    {
        None
    }
}

#[cfg(windows)]
mod windows {
    use super::*;
    use std::ffi::OsStr;
    use std::path::{Path, PathBuf};
    use std::sync::{Mutex, OnceLock};

    use ::windows::core::{BSTR, PCWSTR};
    use ::windows::Win32::Foundation::{
        CloseHandle, GetLastError, ERROR_CANCELLED, VARIANT_BOOL, VARIANT_FALSE, VARIANT_TRUE,
        WAIT_FAILED, WAIT_OBJECT_0,
    };
    use ::windows::Win32::NetworkManagement::WindowsFirewall::{
        INetFwPolicy2, INetFwRule, NetFwPolicy2, NetFwRule, NET_FW_ACTION_ALLOW,
        NET_FW_IP_PROTOCOL_TCP, NET_FW_MODIFY_STATE_GP_OVERRIDE,
        NET_FW_MODIFY_STATE_INBOUND_BLOCKED, NET_FW_MODIFY_STATE_OK, NET_FW_PROFILE2_DOMAIN,
        NET_FW_PROFILE2_PRIVATE, NET_FW_PROFILE2_PUBLIC, NET_FW_RULE_DIR_IN,
    };
    use ::windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER,
        COINIT_APARTMENTTHREADED,
    };
    use ::windows::Win32::System::Threading::{GetExitCodeProcess, WaitForSingleObject, INFINITE};
    use ::windows::Win32::UI::Shell::{
        ShellExecuteExW, SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW,
    };
    use ::windows::Win32::UI::WindowsAndMessaging::SW_HIDE;

    use crate::share_policy::{
        firewall_rule_matches, ipc_error, FirewallRuleSnapshot, ShareErrorCode,
        QUICK_SHARE_FIREWALL_GROUP, QUICK_SHARE_FIREWALL_REMOTE_ADDRESSES,
        QUICK_SHARE_FIREWALL_RULE_NAME, QUICK_SHARE_PORT_TEXT,
    };

    const HELPER_OK: i32 = 0;
    const HELPER_FAILED: i32 = 1;
    const HELPER_POLICY_MANAGED: i32 = 10;
    const HELPER_INBOUND_BLOCKED: i32 = 11;

    static FIREWALL_MUTEX: OnceLock<Mutex<()>> = OnceLock::new();

    struct ComApartment;

    impl ComApartment {
        fn initialize() -> Result<Self, String> {
            let result = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) };
            if result.is_ok() {
                Ok(Self)
            } else {
                Err(format!("CoInitializeEx failed: {result:?}"))
            }
        }
    }

    impl Drop for ComApartment {
        fn drop(&mut self) {
            unsafe { CoUninitialize() };
        }
    }

    enum HelperLaunchError {
        Cancelled,
        Failed(String),
    }

    pub fn ensure_ready() -> Result<(), String> {
        let lock = FIREWALL_MUTEX.get_or_init(|| Mutex::new(()));
        let _guard = lock
            .lock()
            .map_err(|_| ipc_error(ShareErrorCode::FirewallAuthorizationFailed))?;
        let executable = current_executable().map_err(|error| {
            log_detail(format!("resolve current executable failed: {error}"));
            ipc_error(ShareErrorCode::FirewallAuthorizationFailed)
        })?;
        let _com = ComApartment::initialize().map_err(|error| {
            log_detail(error);
            ipc_error(ShareErrorCode::FirewallAuthorizationFailed)
        })?;

        let policy = firewall_policy().map_err(|error| {
            log_detail(format!("create firewall policy failed: {error:?}"));
            ipc_error(ShareErrorCode::FirewallAuthorizationFailed)
        })?;
        let modify_state = unsafe { policy.LocalPolicyModifyState() }.map_err(|error| {
            log_detail(format!("read firewall modify state failed: {error:?}"));
            ipc_error(ShareErrorCode::FirewallAuthorizationFailed)
        })?;

        if rule_is_correct(&policy, &executable) {
            return Ok(());
        }

        match modify_state {
            NET_FW_MODIFY_STATE_GP_OVERRIDE => {
                log_detail("Windows Firewall local policy is managed by Group Policy");
                return Err(ipc_error(ShareErrorCode::FirewallPolicyManaged));
            }
            NET_FW_MODIFY_STATE_INBOUND_BLOCKED => {
                log_detail("Windows Firewall inbound traffic is blocked by policy");
                return Err(ipc_error(ShareErrorCode::FirewallInboundBlocked));
            }
            NET_FW_MODIFY_STATE_OK => {}
            other => {
                log_detail(format!("unexpected firewall modify state: {other:?}"));
                return Err(ipc_error(ShareErrorCode::FirewallAuthorizationFailed));
            }
        }

        log_detail("Quick Share firewall rule is missing or incorrect; requesting one-time UAC");
        let helper_exit = match launch_elevated_helper(&executable) {
            Ok(code) => code,
            Err(HelperLaunchError::Cancelled) => {
                return Err(ipc_error(ShareErrorCode::FirewallAuthorizationCancelled));
            }
            Err(HelperLaunchError::Failed(error)) => {
                log_detail(format!("launch firewall helper failed: {error}"));
                return Err(ipc_error(ShareErrorCode::FirewallAuthorizationFailed));
            }
        };

        match helper_exit {
            HELPER_OK => {}
            HELPER_POLICY_MANAGED => return Err(ipc_error(ShareErrorCode::FirewallPolicyManaged)),
            HELPER_INBOUND_BLOCKED => {
                return Err(ipc_error(ShareErrorCode::FirewallInboundBlocked));
            }
            other => {
                log_detail(format!("firewall helper exited with code {other}"));
                return Err(ipc_error(ShareErrorCode::FirewallAuthorizationFailed));
            }
        }

        let repaired = firewall_policy()
            .map(|policy| rule_is_correct(&policy, &executable))
            .unwrap_or(false);
        if repaired {
            Ok(())
        } else {
            log_detail("firewall helper completed but the exact rule was not observed");
            Err(ipc_error(ShareErrorCode::FirewallAuthorizationFailed))
        }
    }

    pub fn run_helper_if_requested() -> Option<i32> {
        let args: Vec<_> = std::env::args_os().collect();
        if args.len() != 2 || args[1] != OsStr::new(FIREWALL_HELPER_ARGUMENT) {
            return None;
        }

        let result = (|| -> Result<(), String> {
            let executable = current_executable()?;
            let _com = ComApartment::initialize()?;
            install_exact_rule(&executable)
        })();

        let code = match result {
            Ok(()) => HELPER_OK,
            Err(error) => {
                eprintln!("WonderfulUI firewall helper failed: {error}");
                if error == "policy-managed" {
                    HELPER_POLICY_MANAGED
                } else if error == "inbound-blocked" {
                    HELPER_INBOUND_BLOCKED
                } else {
                    HELPER_FAILED
                }
            }
        };
        Some(code)
    }

    fn current_executable() -> Result<PathBuf, String> {
        let path = std::env::current_exe().map_err(|error| error.to_string())?;
        let path = std::fs::canonicalize(&path).unwrap_or(path);
        let value = path.to_string_lossy();
        let value = value.strip_prefix(r"\\?\").unwrap_or(&value);
        Ok(PathBuf::from(value))
    }

    fn firewall_policy() -> ::windows::core::Result<INetFwPolicy2> {
        unsafe { CoCreateInstance(&NetFwPolicy2, None, CLSCTX_INPROC_SERVER) }
    }

    fn rule_is_correct(policy: &INetFwPolicy2, executable: &Path) -> bool {
        let rules = match unsafe { policy.Rules() } {
            Ok(value) => value,
            Err(error) => {
                log_detail(format!("read firewall rules failed: {error:?}"));
                return false;
            }
        };
        let name = BSTR::from(QUICK_SHARE_FIREWALL_RULE_NAME);
        let rule = match unsafe { rules.Item(&name) } {
            Ok(value) => value,
            Err(error) => {
                log_detail(format!("quick share firewall rule lookup: {error:?}"));
                return false;
            }
        };
        rule_properties_match(&rule, executable)
    }

    fn rule_properties_match(rule: &INetFwRule, executable: &Path) -> bool {
        let expected_executable = normalize_path(&executable.to_string_lossy());

        let values = (
            unsafe { rule.Name() },
            unsafe { rule.Grouping() },
            unsafe { rule.ApplicationName() },
            unsafe { rule.Protocol() },
            unsafe { rule.LocalPorts() },
            unsafe { rule.RemoteAddresses() },
            unsafe { rule.Direction() },
            unsafe { rule.Enabled() },
            unsafe { rule.Profiles() },
            unsafe { rule.EdgeTraversal() },
            unsafe { rule.Action() },
        );
        let (
            Ok(name),
            Ok(group),
            Ok(application),
            Ok(protocol),
            Ok(local_ports),
            Ok(remote_addresses),
            Ok(direction),
            Ok(enabled),
            Ok(profiles),
            Ok(edge_traversal),
            Ok(action),
        ) = values
        else {
            return false;
        };

        firewall_rule_matches(
            Some(&FirewallRuleSnapshot {
                name: name.to_string(),
                group: group.to_string(),
                application_name: normalize_path(&application.to_string()),
                enabled: is_true(enabled),
                inbound: direction == NET_FW_RULE_DIR_IN,
                allow: action == NET_FW_ACTION_ALLOW,
                tcp: protocol == NET_FW_IP_PROTOCOL_TCP.0,
                local_ports: local_ports.to_string(),
                profiles,
                remote_addresses: remote_addresses.to_string(),
                edge_traversal: is_true(edge_traversal),
            }),
            &expected_executable,
        )
    }

    fn install_exact_rule(executable: &Path) -> Result<(), String> {
        let policy = firewall_policy().map_err(|error| error.to_string())?;
        match unsafe { policy.LocalPolicyModifyState() }.map_err(|error| error.to_string())? {
            NET_FW_MODIFY_STATE_OK => {}
            NET_FW_MODIFY_STATE_GP_OVERRIDE => return Err("policy-managed".into()),
            NET_FW_MODIFY_STATE_INBOUND_BLOCKED => return Err("inbound-blocked".into()),
            _ => return Err("unsupported-policy-state".into()),
        }

        let rules = unsafe { policy.Rules() }.map_err(|error| error.to_string())?;
        let name = BSTR::from(QUICK_SHARE_FIREWALL_RULE_NAME);
        // Removing by the stable name first makes repair converge even when a
        // previous release left a wrong path, port, protocol, or duplicate.
        let _ = unsafe { rules.Remove(&name) };

        let rule: INetFwRule = unsafe {
            CoCreateInstance(&NetFwRule, None, CLSCTX_INPROC_SERVER)
                .map_err(|error| error.to_string())?
        };
        let group = BSTR::from(QUICK_SHARE_FIREWALL_GROUP);
        let description = BSTR::from("Allow WonderfulUI Quick Share from the local subnet.");
        let application = BSTR::from(executable.to_string_lossy().as_ref());
        let local_ports = BSTR::from(QUICK_SHARE_PORT_TEXT);
        let remote_addresses = BSTR::from(QUICK_SHARE_FIREWALL_REMOTE_ADDRESSES);
        let profiles =
            NET_FW_PROFILE2_DOMAIN.0 | NET_FW_PROFILE2_PRIVATE.0 | NET_FW_PROFILE2_PUBLIC.0;

        unsafe {
            rule.SetName(&name).map_err(|error| error.to_string())?;
            rule.SetGrouping(&group)
                .map_err(|error| error.to_string())?;
            rule.SetDescription(&description)
                .map_err(|error| error.to_string())?;
            rule.SetApplicationName(&application)
                .map_err(|error| error.to_string())?;
            rule.SetProtocol(NET_FW_IP_PROTOCOL_TCP.0)
                .map_err(|error| error.to_string())?;
            rule.SetLocalPorts(&local_ports)
                .map_err(|error| error.to_string())?;
            rule.SetRemoteAddresses(&remote_addresses)
                .map_err(|error| error.to_string())?;
            rule.SetDirection(NET_FW_RULE_DIR_IN)
                .map_err(|error| error.to_string())?;
            rule.SetProfiles(profiles)
                .map_err(|error| error.to_string())?;
            rule.SetEnabled(VARIANT_TRUE)
                .map_err(|error| error.to_string())?;
            rule.SetEdgeTraversal(VARIANT_FALSE)
                .map_err(|error| error.to_string())?;
            rule.SetAction(NET_FW_ACTION_ALLOW)
                .map_err(|error| error.to_string())?;
            rules.Add(&rule).map_err(|error| error.to_string())?;
        }
        Ok(())
    }

    fn launch_elevated_helper(executable: &Path) -> Result<i32, HelperLaunchError> {
        let file = to_wide(executable.as_os_str());
        let verb = to_wide(OsStr::new("runas"));
        let parameters = to_wide(OsStr::new(FIREWALL_HELPER_ARGUMENT));
        let mut info = SHELLEXECUTEINFOW {
            cbSize: std::mem::size_of::<SHELLEXECUTEINFOW>() as u32,
            fMask: SEE_MASK_NOCLOSEPROCESS,
            lpVerb: PCWSTR::from_raw(verb.as_ptr()),
            lpFile: PCWSTR::from_raw(file.as_ptr()),
            lpParameters: PCWSTR::from_raw(parameters.as_ptr()),
            nShow: SW_HIDE.0,
            ..Default::default()
        };

        if let Err(error) = unsafe { ShellExecuteExW(&mut info) } {
            let win32_error = unsafe { GetLastError() };
            if win32_error == ERROR_CANCELLED {
                return Err(HelperLaunchError::Cancelled);
            }
            return Err(HelperLaunchError::Failed(format!(
                "ShellExecuteExW failed: {error:?} ({win32_error:?})"
            )));
        }
        if info.hProcess.is_invalid() {
            return Err(HelperLaunchError::Failed(
                "ShellExecuteExW returned no process handle".into(),
            ));
        }

        let wait_result = unsafe { WaitForSingleObject(info.hProcess, INFINITE) };
        if wait_result == WAIT_FAILED {
            let _ = unsafe { CloseHandle(info.hProcess) };
            return Err(HelperLaunchError::Failed(
                "WaitForSingleObject failed".into(),
            ));
        }
        if wait_result != WAIT_OBJECT_0 {
            let _ = unsafe { CloseHandle(info.hProcess) };
            return Err(HelperLaunchError::Failed(format!(
                "helper wait returned {wait_result:?}"
            )));
        }

        let mut exit_code = u32::MAX;
        let result = unsafe { GetExitCodeProcess(info.hProcess, &mut exit_code) };
        let _ = unsafe { CloseHandle(info.hProcess) };
        result.map_err(|error| {
            HelperLaunchError::Failed(format!("GetExitCodeProcess failed: {error:?}"))
        })?;
        Ok(exit_code as i32)
    }

    fn to_wide(value: &OsStr) -> Vec<u16> {
        value.to_string_lossy().encode_utf16().chain([0]).collect()
    }

    fn normalize_path(value: &str) -> String {
        let trimmed = value.trim().replace('/', "\\");
        let without_prefix = trimmed.strip_prefix(r"\\?\").unwrap_or(&trimmed);
        without_prefix.to_ascii_lowercase()
    }

    fn is_true(value: VARIANT_BOOL) -> bool {
        value != VARIANT_FALSE
    }

    fn log_detail(message: impl AsRef<str>) {
        crate::app_log::write(crate::app_log::LogLevel::Warn, "share-firewall", message);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn helper_accepts_only_the_exact_internal_argument() {
        assert!(helper_args_are_exact(&[
            "wonderful-ui.exe".into(),
            FIREWALL_HELPER_ARGUMENT.into(),
        ]));
        assert!(!helper_args_are_exact(&[
            "wonderful-ui.exe".into(),
            FIREWALL_HELPER_ARGUMENT.into(),
            "--arbitrary-command".into(),
        ]));
        assert!(!helper_args_are_exact(&[
            "wonderful-ui.exe".into(),
            "--wui-firewall-helper=other".into(),
        ]));
        assert!(!helper_args_are_exact(&["wonderful-ui.exe".into()]));
    }
}
