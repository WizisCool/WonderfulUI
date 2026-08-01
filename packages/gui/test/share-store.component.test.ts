import { beforeEach, describe, expect, test, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock('../src/tauri-adapter.ts', () => ({
  invoke: invokeMock,
}));

import {
  FRIENDLY_SHARE_START_ERROR,
  FRIENDLY_SHARE_STOP_ERROR,
  useShareStore,
  type ShareServerInfo,
} from '../src/stores/share.ts';

function info(sessionId: string): ShareServerInfo {
  return {
    sessionId,
    port: 53124,
    token: `token-${sessionId}`,
    url: `http://192.168.1.42:53124/w/token-${sessionId}`,
    lanIp: '192.168.1.42',
    qrSvg: '<svg/>',
    videoName: 'clip.mp4',
    videoSize: 1024,
    startedAtUnix: 1,
  };
}

beforeEach(() => {
  setActivePinia(createPinia());
  invokeMock.mockReset();
});

describe('share store session races', () => {
  test('stop during start invalidates UI and cleans the late backend session', async () => {
    let resolveStart!: (value: ShareServerInfo) => void;
    let startSessionId = '';
    invokeMock.mockImplementation((command: string, args?: Record<string, unknown>) => {
      if (command === 'start_share_server') {
        startSessionId = String(args?.sessionId);
        return new Promise<ShareServerInfo>(resolve => { resolveStart = resolve; });
      }
      return Promise.resolve(undefined);
    });

    const share = useShareStore();
    const startPromise = share.start('D:\\Highlights\\clip.mp4');
    expect(share.status).toBe('starting');

    const stopPromise = share.stop();
    expect(share.status).toBe('idle');
    expect(share.activeSessionId).toBeNull();

    resolveStart(info(startSessionId));
    await Promise.all([startPromise, stopPromise]);

    expect(share.status).toBe('idle');
    expect(share.info).toBeNull();
    const scopedStops = invokeMock.mock.calls.filter(([command]) => command === 'stop_share_server');
    expect(scopedStops.length).toBeGreaterThanOrEqual(1);
    expect(scopedStops.every(([, args]) => args.sessionId === startSessionId)).toBe(true);
  });

  test('events from a replaced server cannot clear or update the current one', async () => {
    invokeMock.mockImplementation((command: string, args?: Record<string, unknown>) => {
      if (command === 'start_share_server') {
        return Promise.resolve(info(String(args?.sessionId)));
      }
      return Promise.resolve(undefined);
    });

    const share = useShareStore();
    await share.start('D:\\Highlights\\first.mp4');
    const oldSessionId = share.info!.sessionId;
    await share.start('D:\\Highlights\\second.mp4');
    const currentSessionId = share.info!.sessionId;

    expect(currentSessionId).not.toBe(oldSessionId);
    expect(share.onStopped({ sessionId: oldSessionId, reason: 'stopped' })).toBe(false);
    expect(share.onDownloaded({
      sessionId: oldSessionId,
      count: 99,
      filename: 'old.mp4',
      sizeBytes: 99,
    })).toBe(false);
    expect(share.status).toBe('running');
    expect(share.info?.sessionId).toBe(currentSessionId);
    expect(share.downloadCount).toBe(0);

    expect(share.onDownloaded({
      sessionId: currentSessionId,
      count: 1,
      filename: 'second.mp4',
      sizeBytes: 1024,
    })).toBe(true);
    expect(share.downloadCount).toBe(1);
  });

  test('keeps native paths and server details out of visible errors', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    invokeMock.mockRejectedValueOnce(new Error('open D:\\Private\\clip.mp4: access denied'));
    const share = useShareStore();

    await share.start('D:\\Private\\clip.mp4');
    expect(share.status).toBe('error');
    expect(share.lastError).toBe(FRIENDLY_SHARE_START_ERROR);
    expect(share.lastError).not.toContain('Private');

    const sessionId = share.activeSessionId!;
    expect(share.onStopped({
      sessionId,
      reason: 'error',
      message: 'listener 0.0.0.0:53124 failed',
    })).toBe(true);
    expect(share.lastError).toBe(FRIENDLY_SHARE_STOP_ERROR);
    expect(share.lastError).not.toContain('53124');
    consoleError.mockRestore();
  });
});
