import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dir, '..');
const config = JSON.parse(
  readFileSync(resolve(root, 'src-tauri/tauri.conf.json'), 'utf8'),
);
const hooks = readFileSync(
  resolve(root, 'src-tauri/windows/installer-hooks.nsh'),
  'utf8',
);
const template = readFileSync(resolve(root, 'src-tauri/installer.nsi'), 'utf8');
const policy = readFileSync(resolve(root, 'src-tauri/src/share_policy.rs'), 'utf8');

const rustPort = policy.match(/QUICK_SHARE_PORT:\s*u16\s*=\s*([\d_]+)/)?.[1]
  ?.replaceAll('_', '');
const rustRuleName = policy.match(
  /QUICK_SHARE_FIREWALL_RULE_NAME:\s*&str\s*=\s*"([^"]+)"/,
)?.[1];

describe('Windows Quick Share firewall installer contract', () => {
  test('runs supported hooks from an elevated fresh install and passive update', () => {
    const nsis = config.bundle.windows.nsis;
    expect(nsis.installMode).toBe('perMachine');
    expect(nsis.installerHooks).toBe('windows/installer-hooks.nsh');
    expect(resolve(root, 'src-tauri', nsis.installerHooks)).toBe(
      resolve(root, 'src-tauri/windows/installer-hooks.nsh'),
    );
    expect(config.plugins.updater.windows.installMode).toBe('passive');

    expect(template).toContain('RequestExecutionLevel admin');
    expect(template).toContain('${GetOptions} $CMDLINE "/UPDATE" $UpdateMode');
    expect(template).toContain('!insertmacro NSIS_HOOK_POSTINSTALL');
    expect(template).toContain('!insertmacro NSIS_HOOK_POSTUNINSTALL');
  });

  test('creates one exact program-scoped TCP rule for local-subnet peers', () => {
    expect(hooks.match(/advfirewall firewall add rule/g)).toHaveLength(1);
    expect(hooks).toContain('name="${WUI_FIREWALL_RULE_NAME}"');
    expect(hooks).toContain('!define WUI_FIREWALL_RULE_NAME "WonderfulUI Quick Share"');
    expect(hooks).toContain('!define WUI_FIREWALL_PROGRAM "$INSTDIR\\wonderful-ui.exe"');
    expect(hooks).toContain('program="${WUI_FIREWALL_PROGRAM}"');
    expect(hooks).toContain('dir=in action=allow');
    expect(hooks).toContain('profile=any protocol=TCP localport=${WUI_FIREWALL_PORT} remoteip=LocalSubnet edge=no');
    expect(hooks).toContain('group="${WUI_FIREWALL_RULE_GROUP}"');
    expect(hooks).not.toContain('protocol=UDP');

    expect(rustPort).toBe('22357');
    expect(rustRuleName).toBe('WonderfulUI Quick Share');
    expect(hooks).toContain(`!define WUI_FIREWALL_PORT "${rustPort}"`);

    const start = hooks.indexOf('!macro NSIS_HOOK_POSTINSTALL');
    const installHook = hooks.slice(start, hooks.indexOf('!macroend', start));
    expect(installHook).toContain('!insertmacro WUI_INSTALL_FIREWALL_RULE');
  });

  test('removes stale rules before adding and preserves the rule only during updates', () => {
    const start = hooks.indexOf('!macro WUI_INSTALL_FIREWALL_RULE');
    const installRule = hooks.slice(start, hooks.indexOf('!macroend', start));
    expect(installRule.indexOf('WUI_REMOVE_FIREWALL_RULE')).toBeLessThan(
      installRule.indexOf('advfirewall firewall add rule'),
    );
    const addRule = installRule
      .split('\n')
      .find(line => line.includes('advfirewall firewall add rule')) ?? '';
    expect(addRule).toContain('localport=${WUI_FIREWALL_PORT}');
    expect(addRule).toContain('program="${WUI_FIREWALL_PROGRAM}"');
    expect(addRule).not.toMatch(/program=.*protocol=TCP(?!.*localport=)/);

    const uninstallHook = hooks.slice(hooks.indexOf('!macro NSIS_HOOK_POSTUNINSTALL'));
    expect(uninstallHook).toContain('${If} $UpdateMode <> 1');
    expect(uninstallHook).toContain('!insertmacro WUI_REMOVE_FIREWALL_RULE');
    expect(template).toContain('!insertmacro NSIS_HOOK_POSTINSTALL');
    expect(template).toContain('!insertmacro NSIS_HOOK_POSTUNINSTALL');
  });
});
