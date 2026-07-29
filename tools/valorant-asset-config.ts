export type ValorantAssetKind = 'agents' | 'maps' | 'gamemodes';

export interface ValorantAssetSpec {
  width: number;
  height: number;
  quality: number;
  maxOutputBytes: number;
}

/**
 * Bump this whenever resize or encoder settings change. The version is part
 * of every public path, so an old generated file can never masquerade as a
 * current build output.
 */
export const VALORANT_ASSET_PIPELINE_VERSION = 'v1';

/**
 * Runtime display sizes are 88x72 for map covers, up to 52x52 for agents and
 * 16x16 for mode icons. These 1:1 / 16:9 outputs retain generous HiDPI headroom
 * without shipping the 1024-3840 px maintenance sources in the installer.
 */
export const VALORANT_ASSET_SPECS: Readonly<Record<ValorantAssetKind, ValorantAssetSpec>> = {
  agents: {
    width: 256,
    height: 256,
    quality: 88,
    maxOutputBytes: 256 * 1024,
  },
  maps: {
    width: 640,
    height: 360,
    quality: 84,
    maxOutputBytes: 512 * 1024,
  },
  gamemodes: {
    width: 128,
    height: 128,
    quality: 90,
    maxOutputBytes: 64 * 1024,
  },
};

export function compiledValorantAssetPath(
  kind: ValorantAssetKind,
  sourceSha256: string,
): string {
  if (!/^[a-f0-9]{64}$/.test(sourceSha256)) {
    throw new Error(`invalid Valorant source SHA-256: ${sourceSha256}`);
  }
  return `/valorant/${kind}/${VALORANT_ASSET_PIPELINE_VERSION}-${sourceSha256}.webp`;
}
