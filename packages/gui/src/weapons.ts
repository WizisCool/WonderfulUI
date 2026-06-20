/**
 * Weapon name normalization for ACLOS `event_ext.WeaponSkinName` strings.
 *
 * ACLOS stores weapon identifiers as Unreal Engine class paths like
 *   `LugerPistol_Ashen_PrimaryAsset.Default__LugerPistol_Ashen_PrimaryAsset_C`
 * The leading `LugerPistol` is the internal weapon code (Ghost in this case),
 * and the trailing `Ashen` etc. is the skin. We strip the UE class decoration
 * then map the weapon code to its Valorant Chinese name.
 *
 * The mapping below was assembled from Valorant weapon internal class names
 * and ACLOS observed values. Unknown codes fall back to a cleaned English
 * label so new weapons degrade gracefully until the map is updated.
 */
import { VALORANT_SKIN_CN } from './generated/valorant-skins.zh-CN.ts';

const WEAPON_CN: Record<string, string> = {
  // ── Sidearms / 手枪
  Luger:         '鬼魅',
  Revolver:      '正义',
  ClassicPistol: '标配',
  ShortyPistol:  '短炮',
  FrenzyPistol:  '狂怒',
  GhostPistol:   '鬼魅',
  SheriffPistol: '正义',
  LugerPistol:   '鬼魅',     // ACLOS 内部用 "Luger" 表示 Ghost
  RevolverPistol:'正义',     // ACLOS 用 "Revolver" 表示 Sheriff
  BasePistol:    '标配',
  AutomaticPistol: '狂怒',
  SawedOffShotgun: '短炮',

  // ── SMGs / 冲锋枪
  StingerSMG: '蜂刺',
  SpectreSMG: '骇灵',
  MP5:        '骇灵',
  SubMachineGun: '骇灵',
  Vector:     '蜂刺',

  // ── Shotguns / 霰弹枪
  BuckyShotgun:  '雄鹿',
  JudgeShotgun:  '判官',
  PumpShotgun:   '雄鹿',
  AutoShotgun:   '判官',
  AutomaticShotgun: '判官',

  // ── Rifles / 步枪
  VandalRifle:  '狂徒',
  PhantomRifle: '幻影',
  BulldogRifle: '獠犬',
  GuardianRifle:'戍卫',
  AK:           '狂徒',     // ACLOS 用 "AK" 表示 Vandal
  ACR:          '幻影',     // ACLOS 用 "ACR" 表示 Phantom
  DMR:          '戍卫',
  Carbine:      '獠犬',
  AssaultRifle: '狂徒',
  AssaultRifle_AK: '狂徒',
  AssaultRifle_ACR: '幻影',
  AssaultRifle_Burst: '獠犬',
  Burst:        '獠犬',

  // ── Snipers / 狙击
  OperatorSniper:   '冥驹',
  MarshalSniper:    '飞将',
  BoltActionSniper: '冥驹',
  BoltSniper:       '冥驹',
  SemiAutoSniper:   '飞将',
  LeverSniper:      '飞将',
  LeverSniperRifle: '飞将',

  // ── Machine guns / 机枪
  AresMachineGun:  '战神',
  OdinMachineGun:  '奥丁',
  LightMachineGun: '战神',
  HeavyMachineGun: '奥丁',
  LMG:             '奥丁',

  // ── Melee / 近战
  Knife:        '匕首',
  CombatKnife:  '匕首',
  TacticalKnife:'战术匕首',
  Melee:        '近战',
};

/**
 * Take an ACLOS `WeaponSkinName` path and return a human-readable
 * "<Chinese weapon> · <skin>" label, or just the Chinese name when no
 * skin suffix is present. Returns `'—'` for empty input.
 */
export function weaponLabel(path: string | undefined | null): string {
  if (!path) return '—';
  const cleaned = cleanAssetBase(path);
  if (!cleaned) return '—';
  const weapon = weaponCodeFromAsset(cleaned);
  const skin = cleaned.length > weapon.length + 1 ? cleaned.slice(weapon.length + 1) : '';
  const weaponName = WEAPON_CN[weapon] ?? weapon;
  return skin ? `${weaponName} · ${skinName(path, weaponName, skin)}` : weaponName;
}

/** Just the weapon name (no skin), useful for compact UI. */
export function weaponNameOnly(path: string | undefined | null): string {
  if (!path) return '—';
  const cleaned = cleanAssetBase(path);
  if (!cleaned) return '—';
  const weapon = weaponCodeFromAsset(cleaned);
  return WEAPON_CN[weapon] ?? weapon;
}

function weaponCodeFromAsset(cleaned: string): string {
  let best = '';
  for (const code of Object.keys(WEAPON_CN)) {
    if (cleaned === code || cleaned.startsWith(`${code}_`)) {
      if (code.length > best.length) best = code;
    }
  }
  if (best) return best;
  return cleaned.split('_')[0] ?? cleaned;
}

function skinName(path: string, weaponName: string, fallback: string): string {
  for (const key of skinLookupKeys(path)) {
    const displayName = VALORANT_SKIN_CN[key];
    if (displayName) return stripWeaponSuffix(displayName, weaponName);
  }
  return fallback;
}

function stripWeaponSuffix(displayName: string, weaponName: string): string {
  const suffix = ` ${weaponName}`;
  return displayName.endsWith(suffix)
    ? displayName.slice(0, -suffix.length).trim()
    : displayName;
}

function skinLookupKeys(path: string): string[] {
  const cleaned = cleanAssetBase(path);
  if (!cleaned) return [];
  const keys = [cleaned];
  const idx = cleaned.indexOf('_');
  if (idx < 0) return keys;
  const weapon = cleaned.slice(0, idx);
  const skin = cleaned.slice(idx);
  const alias = WEAPON_API_ALIASES[weapon];
  if (alias) keys.push(`${alias}${skin}`);
  return keys;
}

function cleanAssetBase(path: string | undefined | null): string {
  if (!path) return '';
  const last = path.split('/').pop() ?? path;
  const beforeDot = last.split('.')[0] ?? last;
  return beforeDot.replace(/_PrimaryAsset(?:_C)?$/, '').trim();
}

const WEAPON_API_ALIASES: Record<string, string> = {
  Luger: 'LugerPistol',
  Revolver: 'RevolverPistol',
  AK: 'AssaultRifle_AK',
  ACR: 'AssaultRifle_ACR',
  MP5: 'SubMachineGun_MP5',
};
