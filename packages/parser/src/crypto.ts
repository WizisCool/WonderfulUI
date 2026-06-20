/**
 * Crypto layer for ACLOS WonderfulDb.
 *
 * File format (verified against ACLOS 2.15.3.449, @tencent/icreate-wonderful@3.5.2):
 *   - file body is hex-encoded ASCII (0-9, a-f)
 *   - decoded bytes = AES-256-CBC ciphertext (PKCS7 padding, stripped by Web Crypto)
 *   - key = sha256(openid).hex.substring(0, 32) as UTF-8 bytes  (32 bytes)
 *   - iv  = sha256(openid).hex.substring(0, 16) as UTF-8 bytes  (16 bytes)
 *   - plaintext = JSON object: { "key_wonderful_list_<openid>": Match[] }
 *
 * Uses Web Crypto (globalThis.crypto.subtle), so it works in Node 20+, Bun,
 * and WebView2 with no Node-specific imports. Async because subtle is async.
 *
 * Reference: packages/parser/src/schema/_acl-source/safeUtils.js
 */

const KEY_HEX_LEN = 32;  // sha256 hex prefix for AES-256 key
const IV_HEX_LEN = 16;   // sha256 hex prefix for IV

async function sha256Hex(s: string): Promise<string> {
  const data = new TextEncoder().encode(s);
  const hashBuf = await crypto.subtle.digest('SHA-256', data);
  const bytes = new Uint8Array(hashBuf);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]!;
    hex += (b >>> 4).toString(16) + (b & 0x0f).toString(16);
  }
  return hex;
}

export async function deriveKeyIv(openid: string): Promise<{ key: Uint8Array; iv: Uint8Array }> {
  const sha = await sha256Hex(openid);
  return {
    key: new TextEncoder().encode(sha.substring(0, KEY_HEX_LEN)),
    iv: new TextEncoder().encode(sha.substring(0, IV_HEX_LEN)),
  };
}

export async function aesDecrypt(ciphertext: Uint8Array, key: Uint8Array, iv: Uint8Array): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key as BufferSource,
    { name: 'AES-CBC' },
    false,
    ['decrypt'],
  );
  const plainBuf = await crypto.subtle.decrypt(
    { name: 'AES-CBC', iv: iv as BufferSource },
    cryptoKey,
    ciphertext as BufferSource,
  );
  return new Uint8Array(plainBuf);
}

/** Decrypt a WonderfulDb buffer (= decoded hex bytes) given the openid. Returns the JSON plaintext. */
export async function decryptWonderfulDbBuffer(buf: Uint8Array, openid: string): Promise<string> {
  const { key, iv } = await deriveKeyIv(openid);
  const plain = await aesDecrypt(buf, key, iv);
  return new TextDecoder().decode(plain);
}
