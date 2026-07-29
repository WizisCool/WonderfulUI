import type { ShareStatus } from '../stores/share.ts';

let fallbackSessionSequence = 0;

/** Stable across WebView reloads with a collision-resistant browser UUID. */
export function createShareSessionId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  // Identity only, never authentication. This fallback supports old test or
  // debug runtimes; the URL's Rust-generated 256-bit token remains the secret.
  fallbackSessionSequence += 1;
  return `share-${Date.now().toString(36)}-${fallbackSessionSequence.toString(36)}`;
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
