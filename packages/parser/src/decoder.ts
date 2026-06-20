/**
 * Hex decoder for ACLOS WonderfulDb files.
 *
 * WonderfulDb files are pure ASCII hex (0-9, a-f) — the encoded payload of
 * a binary structure. This module decodes them back to bytes with strict
 * validation. Pure / runtime-agnostic: works in Node, Bun, and WebView2.
 */

export class HexDecodeError extends Error {
  constructor(message: string, public readonly position: number) {
    super(`Hex decode error at position ${position}: ${message}`);
    this.name = 'HexDecodeError';
  }
}

const HEX_RE = /^[0-9a-f]+$/i;

export function hexToBytes(text: string): Uint8Array {
  const len = text.length;
  if (len === 0) return new Uint8Array(0);
  if (len % 2 !== 0) {
    throw new HexDecodeError('odd number of hex characters', len);
  }
  if (!HEX_RE.test(text)) {
    for (let i = 0; i < len; i++) {
      const c = text.charCodeAt(i);
      if (!((c >= 0x30 && c <= 0x39) || (c >= 0x61 && c <= 0x66) || (c >= 0x41 && c <= 0x46))) {
        throw new HexDecodeError(`non-hex character '${text[i]}' (0x${c.toString(16)})`, i);
      }
    }
  }
  const out = new Uint8Array(len / 2);
  for (let i = 0; i < len; i += 2) {
    out[i >>> 1] = parseInt(text.substring(i, i + 2), 16);
  }
  return out;
}

export function isHexText(text: string): boolean {
  return text.length > 0 && text.length % 2 === 0 && HEX_RE.test(text);
}
