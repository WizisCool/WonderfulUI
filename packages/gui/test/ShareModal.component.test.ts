import { describe, expect, test, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { nextTick } from 'vue';

const invokeMock = vi.hoisted(() => vi.fn((..._args: unknown[]) => Promise.resolve<unknown>(undefined)));
const listenMock = vi.hoisted(() => vi.fn());

vi.mock('../src/tauri-adapter.ts', () => ({
  invoke: invokeMock,
  listen: listenMock,
}));

vi.mock('../src/utils/client-log.ts', () => ({
  clientLog: vi.fn(),
}));

import ShareModal from '../src/components/share/ShareModal.vue';
import { useShareStore } from '../src/stores/share.ts';

describe('ShareModal async lifecycle', () => {
  test('unmount during listener registration never starts a hidden server', async () => {
    let resolveListen!: (unlisten: () => void) => void;
    const unlisten = vi.fn();
    listenMock.mockReset();
    invokeMock.mockClear();
    listenMock.mockImplementationOnce(
      () => new Promise<() => void>(resolve => { resolveListen = resolve; }),
    );

    const wrapper = mount(ShareModal, {
      props: {
        videoPath: 'D:\\Highlights\\clip.mp4',
        videoName: 'clip.mp4',
      },
      global: { plugins: [createPinia()] },
    });
    expect(listenMock).toHaveBeenCalledTimes(1);

    wrapper.unmount();
    resolveListen(unlisten);
    await flushPromises();

    expect(unlisten).toHaveBeenCalledTimes(1);
    expect(listenMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).not.toHaveBeenCalledWith(
      'start_share_server',
      expect.anything(),
    );
  });

  test('labels the QR action and announces download completion', async () => {
    listenMock.mockReset();
    invokeMock.mockReset();
    listenMock.mockResolvedValue(vi.fn());
    invokeMock.mockImplementation((...call: unknown[]) => {
      const command = String(call[0]);
      const args = call[1] as Record<string, unknown> | undefined;
      if (command === 'start_share_server') {
        const sessionId = String(args?.sessionId);
        return Promise.resolve({
          sessionId,
          port: 53124,
          token: 'token',
          url: 'http://192.168.1.2:53124/w/token',
          lanIp: '192.168.1.2',
          qrSvg: '<svg/>',
          videoName: 'clip.mp4',
          videoSize: 1024,
          startedAtUnix: 1,
        });
      }
      return Promise.resolve(undefined);
    });

    const pinia = createPinia();
    const wrapper = mount(ShareModal, {
      props: {
        videoPath: 'D:\\Highlights\\clip.mp4',
        videoName: 'clip.mp4',
      },
      global: { plugins: [pinia] },
    });
    await flushPromises();

    const qr = document.body.querySelector('.share-modal-qr-frame');
    const status = document.body.querySelector('.share-modal-status-row');
    const progress = document.body.querySelector('.share-modal-progress');
    expect(qr?.getAttribute('aria-label')).toBe('复制快传链接');
    expect(status?.getAttribute('aria-live')).toBe('polite');
    expect(progress?.getAttribute('role')).toBe('progressbar');
    expect(progress?.hasAttribute('aria-valuenow')).toBe(false);

    const share = useShareStore();
    share.onDownloaded({
      sessionId: share.activeSessionId!,
      count: 1,
      filename: 'clip.mp4',
      sizeBytes: 1024,
    });
    await nextTick();
    expect(progress?.getAttribute('aria-valuenow')).toBe('100');
    expect(progress?.getAttribute('aria-valuetext')).toBe('下载完成');
    wrapper.unmount();
  });
});
