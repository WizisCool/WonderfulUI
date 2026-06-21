import { describe, expect, test } from 'bun:test';
import { weaponLabel, weaponNameOnly } from '../src/utils/weapons.ts';

describe('weapon name normalization', () => {
  test('maps ACLOS internal weapon codes before the skin suffix', () => {
    expect(weaponNameOnly('LugerPistol_Ashen_PrimaryAsset.Default__LugerPistol_Ashen_PrimaryAsset_C')).toBe('鬼魅');
    expect(weaponNameOnly('AK_Fallen_PrimaryAsset.Default__AK_Fallen_PrimaryAsset_C')).toBe('狂徒');
    expect(weaponNameOnly('DMR_Standard_PrimaryAsset.Default__DMR_Standard_PrimaryAsset_C')).toBe('戍卫');
    expect(weaponNameOnly('Vector_Standard_PrimaryAsset.Default__Vector_Standard_PrimaryAsset_C')).toBe('蜂刺');
    expect(weaponNameOnly('SubMachineGun_MP5_Standard_PrimaryAsset.Default__SubMachineGun_MP5_Standard_PrimaryAsset_C')).toBe('骇灵');
    expect(weaponNameOnly('AssaultRifle_ACR_Standard_PrimaryAsset.Default__AssaultRifle_ACR_Standard_PrimaryAsset_C')).toBe('幻影');
    expect(weaponNameOnly('AssaultRifle_Burst_Standard_PrimaryAsset.Default__AssaultRifle_Burst_Standard_PrimaryAsset_C')).toBe('獠犬');
    expect(weaponNameOnly('RevolverPistol_Standard_PrimaryAsset.Default__RevolverPistol_Standard_PrimaryAsset_C')).toBe('正义');
    expect(weaponNameOnly('SawedOffShotgun_Standard_PrimaryAsset.Default__SawedOffShotgun_Standard_PrimaryAsset_C')).toBe('短炮');
  });

  test('keeps readable skin names without leaking UE class decoration', () => {
    expect(weaponLabel('RevolverPistol_Ashen_PrimaryAsset.Default__RevolverPistol_Ashen_PrimaryAsset_C'))
      .toBe('正义 · Ashen');
  });

  test('uses local Valorant API skin dump when an API asset key matches', () => {
    expect(weaponLabel('AK_Anime2_PrimaryAsset.Default__AK_Anime2_PrimaryAsset_C'))
      .toBe('狂徒 · 无畏契约GO！第二卷');
  });

  test('matches ACLOS weapon aliases against Valorant API asset keys', () => {
    expect(weaponLabel('LugerPistol_Ashen_PrimaryAsset.Default__LugerPistol_Ashen_PrimaryAsset_C'))
      .toBe('鬼魅 · 盖亚的复仇');
  });
});
