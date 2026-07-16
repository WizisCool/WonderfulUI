import type { ShareStatus } from '../stores/share.ts';

/** True when a new start() may begin (blocks only in-flight starting). */
export function canBeginShareStart(status: ShareStatus): boolean {
  return status !== 'starting';
}

/**
 * After await start_share_server, only commit running state if we are still
 * in the starting handshake (user may have stop()'d meanwhile).
 */
export function shouldCommitShareStart(status: ShareStatus): boolean {
  return status === 'starting';
}
