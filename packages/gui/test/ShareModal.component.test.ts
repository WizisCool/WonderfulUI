import { describe, expect, test, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia } from 'pinia';

const invokeMock = vi.hoisted(() => vi.fn(async () => undefined));
const listenMock = vi.hoisted(() => vi.fn());

vi.mock('../src/tauri-adapter.ts', () => ({
  invoke: invokeMock,
  listen: listenMock,
}));

vi.mock('../src/utils/client-log.ts', () => ({
  clientLog: vi.fn(),
}));

import ShareModal from '../src/components/share/ShareModal.vue';

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
});
