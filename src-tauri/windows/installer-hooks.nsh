; WonderfulUI Windows installer hooks.
;
; Quick Share always listens on 22357/TCP. The rule is intentionally narrow:
; one installed executable, one TCP local port, all Windows profiles, and only
; peers in the local subnet. This is a best-effort installer action: GPO or a
; third-party firewall may reject it, but the application must still install.

!define WUI_FIREWALL_RULE_NAME "WonderfulUI Quick Share"
!define WUI_FIREWALL_RULE_GROUP "WonderfulUI"
!define WUI_FIREWALL_PORT "22357"
!define WUI_FIREWALL_PROGRAM "$INSTDIR\wonderful-ui.exe"

!macro WUI_REMOVE_FIREWALL_RULE
  nsExec::ExecToLog '"$SYSDIR\netsh.exe" advfirewall firewall delete rule name="${WUI_FIREWALL_RULE_NAME}"'
  Pop $0
!macroend

!macro WUI_INSTALL_FIREWALL_RULE
  DetailPrint "Configuring Windows Firewall for WonderfulUI Quick Share (TCP ${WUI_FIREWALL_PORT})..."

  ; Delete by stable name first so a fresh install, reinstall, and /UPDATE all
  ; converge on one rule with the current installation path and exact policy.
  !insertmacro WUI_REMOVE_FIREWALL_RULE

  nsExec::ExecToLog '"$SYSDIR\netsh.exe" advfirewall firewall add rule name="${WUI_FIREWALL_RULE_NAME}" group="${WUI_FIREWALL_RULE_GROUP}" dir=in action=allow program="${WUI_FIREWALL_PROGRAM}" enable=yes profile=any protocol=TCP localport=${WUI_FIREWALL_PORT} remoteip=LocalSubnet edge=no description="Allow WonderfulUI Quick Share downloads from this local subnet."'
  Pop $0
  ${If} $0 == 0
    DetailPrint "Windows Firewall rule configured successfully."
  ${Else}
    DetailPrint "Windows Firewall rule could not be configured (exit code $0); installation will continue."
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; The template invokes this after files are copied for normal installs and
  ; Tauri's passive /UPDATE path, before the updated app is relaunched.
  !insertmacro WUI_INSTALL_FIREWALL_RULE
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ; Keep the rule while an updater is replacing files. A complete uninstall
  ; removes it so Windows Firewall is not left with an orphaned exception.
  ${If} $UpdateMode <> 1
    DetailPrint "Removing WonderfulUI Quick Share firewall rule..."
    !insertmacro WUI_REMOVE_FIREWALL_RULE
  ${EndIf}
!macroend
