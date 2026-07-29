import { afterEach, describe, expect, test, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import DateRangePicker from '../src/components/match/DateRangePicker.vue';

afterEach(() => {
  vi.useRealTimers();
  document.querySelectorAll('.dr-popover').forEach(node => node.remove());
});

describe('DateRangePicker trigger', () => {
  test('renders the trigger and clear action as sibling buttons', () => {
    const wrapper = mount(DateRangePicker, {
      props: { modelValue: [1_719_000_000_000, 1_719_086_399_999] },
    });

    expect(wrapper.find('.dr-trigger').element.tagName).toBe('BUTTON');
    expect(wrapper.find('.dr-trigger-clear').element.tagName).toBe('BUTTON');
    expect(wrapper.find('.dr-trigger .dr-trigger-clear').exists()).toBe(false);
    expect(wrapper.findAll('.dr-trigger-wrap > button')).toHaveLength(2);
  });

  test('clears without opening the date dialog', async () => {
    const wrapper = mount(DateRangePicker, {
      props: { modelValue: [1_719_000_000_000, 1_719_086_399_999] },
    });

    await wrapper.find('.dr-trigger-clear').trigger('click');

    expect(wrapper.emitted('update:modelValue')).toEqual([[[null, null]]]);
    expect(wrapper.find('.dr-trigger').attributes('aria-expanded')).toBe('false');
    expect(document.querySelector('.dr-popover')).toBeNull();
  });

  test('does not bind a late outside-click listener after immediate close', async () => {
    vi.useFakeTimers();
    const addListener = vi.spyOn(document, 'addEventListener');
    const wrapper = mount(DateRangePicker, {
      props: { modelValue: [null, null] },
    });

    await wrapper.find('.dr-trigger').trigger('click');
    await wrapper.find('.dr-trigger').trigger('click');
    vi.runAllTimers();

    const outsideBindings = addListener.mock.calls.filter(([event]) => event === 'mousedown');
    expect(outsideBindings).toHaveLength(0);
    expect(wrapper.find('.dr-trigger').attributes('aria-expanded')).toBe('false');

    wrapper.unmount();
    addListener.mockRestore();
  });
});
