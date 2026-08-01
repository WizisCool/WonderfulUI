import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { flushPromises, shallowMount } from '@vue/test-utils';
import { createTestingPinia } from '@pinia/testing';
import { setActivePinia } from 'pinia';
import * as tauriAdapter from '../src/tauri-adapter.ts';
import { useAccountStore } from '../src/stores/account.ts';
import { useUiStore } from '../src/stores/ui.ts';
import App from '../src/App.vue';

const BootOverlayStub = defineComponent({
  name: 'BootOverlay',
  setup(_, { expose }) {
    expose({ start: vi.fn(), complete: vi.fn() });
    return () => h('div', { class: 'boot-overlay-stub' });
  },
});

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('App startup refresh lifecycle', () => {
  test('keeps the terminal listener after timeout and guarded-reloads on late completion', async () => {
    let terminalHandler!: (event: { payload: Record<string, unknown> }) => void;
    const unlisten = vi.fn();
    vi.spyOn(tauriAdapter, 'listen').mockImplementation(async (event, handler) => {
      expect(event).toBe('wui://startup_refresh_finished');
      terminalHandler = handler as typeof terminalHandler;
      return unlisten;
    });
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const pinia = createTestingPinia({ createSpy: vi.fn });
    setActivePinia(pinia);
    const account = useAccountStore();
    const ui = useUiStore();
    vi.mocked(account.probeAclos).mockResolvedValue({
      dir: 'D:\\WonderfulDb',
      dirExists: true,
      hasAccounts: true,
    });
    vi.mocked(account.scanShell).mockResolvedValue(undefined);
    vi.mocked(account.loadLibrary).mockResolvedValue(undefined);
    vi.mocked(account.loadLibraryIfCurrent).mockResolvedValue(true);
    vi.mocked(account.cacheAssets).mockResolvedValue(undefined);

    const wrapper = shallowMount(App, {
      global: {
        plugins: [pinia],
        stubs: {
          BootOverlay: BootOverlayStub,
          RouterView: true,
          Teleport: true,
        },
      },
    });
    await flushPromises();
    expect(account.scanShell).toHaveBeenCalledTimes(1);
    expect(unlisten).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(30_000);
    await flushPromises();
    expect(wrapper.find('.app').exists()).toBe(true);
    expect(unlisten).not.toHaveBeenCalled();

    terminalHandler({ payload: { status: 'finished' } });
    await flushPromises();
    expect(unlisten).toHaveBeenCalledTimes(1);
    expect(account.loadLibraryIfCurrent).toHaveBeenCalledWith(account.libraryRevision);
    expect(ui.showToast).toHaveBeenCalledWith('资料库已在后台刷新完成', 'ok');
    wrapper.unmount();
  });

  test('settles the frontend wait and stops boot work when App unmounts', async () => {
    const unlisten = vi.fn();
    vi.spyOn(tauriAdapter, 'listen').mockResolvedValue(unlisten);
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const pinia = createTestingPinia({ createSpy: vi.fn });
    setActivePinia(pinia);
    const account = useAccountStore();
    const ui = useUiStore();
    vi.mocked(account.probeAclos).mockResolvedValue({
      dir: 'D:\\WonderfulDb',
      dirExists: true,
      hasAccounts: true,
    });
    vi.mocked(account.scanShell).mockResolvedValue(undefined);
    vi.mocked(account.loadLibrary).mockResolvedValue(undefined);
    vi.mocked(account.cacheAssets).mockResolvedValue(undefined);

    const wrapper = shallowMount(App, {
      global: {
        plugins: [pinia],
        stubs: {
          BootOverlay: BootOverlayStub,
          RouterView: true,
          Teleport: true,
        },
      },
    });
    await flushPromises();
    expect(account.loadLibrary).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    wrapper.unmount();
    await flushPromises();

    expect(unlisten).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    expect(account.loadLibrary).toHaveBeenCalledTimes(1);
    expect(account.cacheAssets).not.toHaveBeenCalled();
    expect(ui.showToast).not.toHaveBeenCalled();
  });
});
