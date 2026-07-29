import { beforeEach, describe, expect, test, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia } from 'pinia';

const listenMock = vi.hoisted(() => vi.fn());

vi.mock('../src/tauri-adapter.ts', () => ({
  listen: listenMock,
}));

vi.mock('../src/utils/render-pulse.ts', () => ({
  pulseRendererForMotion: vi.fn(),
}));

import BootOverlay from '../src/components/common/BootOverlay.vue';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(resolvePromise => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

beforeEach(() => {
  listenMock.mockReset();
});

describe('BootOverlay event lifecycle', () => {
  test('coalesces start while the mounted event wiring is still pending', async () => {
    const firstListen = deferred<() => void>();
    listenMock
      .mockReturnValueOnce(firstListen.promise)
      .mockImplementation(() => Promise.resolve(vi.fn()));

    const wrapper = mount(BootOverlay, {
      global: { plugins: [createPinia()] },
    });
    expect(listenMock).toHaveBeenCalledTimes(1);

    (wrapper.vm as unknown as { start: () => void }).start();
    expect(listenMock).toHaveBeenCalledTimes(1);

    firstListen.resolve(vi.fn());
    await vi.waitFor(() => expect(listenMock).toHaveBeenCalledTimes(6));
    expect(listenMock.mock.calls.map(call => call[0])).toEqual([
      'wui://phase',
      'wui://scrape_summary',
      'wui://account_started',
      'wui://account_loaded',
      'wui://account_finished',
      'wui://cache_asset_progress',
    ]);
    wrapper.unmount();
  });

  test('immediately releases a listener that resolves after unmount', async () => {
    const firstListen = deferred<() => void>();
    const unlisten = vi.fn();
    listenMock.mockReturnValueOnce(firstListen.promise);

    const wrapper = mount(BootOverlay, {
      global: { plugins: [createPinia()] },
    });
    wrapper.unmount();
    firstListen.resolve(unlisten);

    await vi.waitFor(() => expect(unlisten).toHaveBeenCalledTimes(1));
    expect(listenMock).toHaveBeenCalledTimes(1);
  });
});
