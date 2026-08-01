import type { ShareStatus } from '../stores/share.ts';

/** Stable across WebView reloads with a collision-resistant browser UUID. */
export function createShareSessionId(): string {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === 'function') {
    return cryptoApi.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (typeof cryptoApi?.getRandomValues === 'function') {
    cryptoApi.getRandomValues(bytes);
  } else {
    // Identity only, never authentication. This supports very old test/debug
    // runtimes; the URL's Rust-generated 256-bit token remains the secret.
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  return formatShareSessionUuidV4(bytes);
}

export function formatShareSessionUuidV4(source: Uint8Array): string {
  if (source.length !== 16) throw new Error('UUID v4 requires exactly 16 bytes');
  const bytes = Uint8Array.from(source);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** True when a new start() may begin (blocks only in-flight starting). */
export function canBeginShareStart(status: ShareStatus): boolean {
  return status !== 'starting';
}

/** A start result belongs only to the still-active handshake that created it. */
export function shouldCommitShareStart(
  status: ShareStatus,
  activeSessionId: string | null,
  requestSessionId: string,
): boolean {
  return status === 'starting' && activeSessionId === requestSessionId;
}

/** Ignore downloads/stops emitted by a server that has already been replaced. */
export function shouldHandleShareEvent(
  activeSessionId: string | null,
  eventSessionId: string,
): boolean {
  return activeSessionId === eventSessionId;
}
