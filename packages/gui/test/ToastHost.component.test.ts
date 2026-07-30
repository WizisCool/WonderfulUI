import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createTestingPinia } from '@pinia/testing';
import { setActivePinia } from 'pinia';
import { nextTick } from 'vue';
import ToastHost from '../src/components/common/ToastHost.vue';
import { useUiStore } from '../src/stores/ui.ts';

function mountHost(pinia = createTestingPinia({ createSpy: vi.fn, stubActions: false })) {
  return mount(ToastHost, {
    global: {
      plugins: [pinia],
    },
  });
}

describe('ToastHost event lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('renders every request while a prior toast is still visible', async () => {
    const wrapper = mountHost();
    const ui = useUiStore();

    ui.showToast('重复消息', 'ok');
    ui.showToast('重复消息', 'error');
    await nextTick();

    const items = wrapper.findAll('.toast');
    expect(items).toHaveLength(2);
    expect(items.map(item => item.text())).toEqual(['重复消息', '重复消息']);
    expect(items[0]!.attributes('role')).toBe('status');
    expect(items[1]!.attributes('role')).toBe('alert');

    await vi.advanceTimersByTimeAsync(6_000);
    wrapper.unmount();
  });

  test('renders the latest request emitted before the host mounts', () => {
    const pinia = createTestingPinia({ createSpy: vi.fn, stubActions: false });
    setActivePinia(pinia);
    useUiStore().showToast('启动失败', 'error');

    const wrapper = mountHost(pinia);

    expect(wrapper.get('.toast').text()).toBe('启动失败');
    expect(wrapper.get('.toast').attributes('role')).toBe('alert');
    wrapper.unmount();
  });

  test('clears every pending removal timer on unmount', () => {
    const wrapper = mountHost();
    const directShow = (window as unknown as {
      __wuiToast: (message: string, kind?: 'ok' | 'error') => void;
    }).__wuiToast;
    directShow('one');
    directShow('two', 'error');
    expect(vi.getTimerCount()).toBe(2);

    wrapper.unmount();

    expect(vi.getTimerCount()).toBe(0);
    expect((window as unknown as { __wuiToast?: unknown }).__wuiToast).toBeUndefined();
  });
});
