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

  test('labels one-sided persisted ranges instead of looking unselected', () => {
    const start = new Date(2026, 5, 15).getTime();
    const from = mount(DateRangePicker, { props: { modelValue: [start, null] } });
    expect(from.get('.dr-trigger-text').text()).toBe('从 2026-06-15');
    expect(from.find('.dr-trigger-clear').exists()).toBe(true);
    from.unmount();

    const until = mount(DateRangePicker, { props: { modelValue: [null, start] } });
    expect(until.get('.dr-trigger-text').text()).toBe('至 2026-06-15');
    expect(until.find('.dr-trigger-clear').exists()).toBe(true);
    until.unmount();
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

  test('moves focus into the calendar and preserves it after choosing a date', async () => {
    const wrapper = mount(DateRangePicker, {
      attachTo: document.body,
      props: { modelValue: [null, null] },
    });

    await wrapper.find('.dr-trigger').trigger('click');
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));

    const focused = document.activeElement as HTMLButtonElement;
    expect(focused.classList.contains('dr-day')).toBe(true);
    expect(focused.tabIndex).toBe(0);
    expect(focused.getAttribute('aria-label')).toMatch(/\d+年\d+月\d+日/);

    focused.click();
    expect(document.activeElement?.classList.contains('dr-day')).toBe(true);
    expect((document.activeElement as HTMLElement).dataset.time).toBe(focused.dataset.time);
    wrapper.unmount();
  });

  test('supports arrow and month keyboard navigation without date overflow', async () => {
    const january31 = new Date(2025, 0, 31).getTime();
    const wrapper = mount(DateRangePicker, {
      attachTo: document.body,
      props: { modelValue: [january31, january31] },
    });

    await wrapper.find('.dr-trigger').trigger('click');
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    const initial = document.activeElement as HTMLButtonElement;
    expect(new Date(Number(initial.dataset.time)).getDate()).toBe(31);

    initial.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true }));
    const february = new Date(Number((document.activeElement as HTMLElement).dataset.time));
    expect(february.getMonth()).toBe(1);
    expect(february.getDate()).toBe(28);

    const beforeArrow = new Date(february);
    document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'ArrowRight',
      bubbles: true,
    }));
    const afterArrow = new Date(Number((document.activeElement as HTMLElement).dataset.time));
    beforeArrow.setDate(beforeArrow.getDate() + 1);
    expect(afterArrow.getTime()).toBe(beforeArrow.getTime());
    wrapper.unmount();
  });

  test('Escape closes the dialog and restores focus to its trigger', async () => {
    const wrapper = mount(DateRangePicker, {
      attachTo: document.body,
      props: { modelValue: [null, null] },
    });
    const trigger = wrapper.get('.dr-trigger').element as HTMLButtonElement;
    await wrapper.get('.dr-trigger').trigger('click');
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));

    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
    }));
    await wrapper.vm.$nextTick();

    expect(wrapper.get('.dr-trigger').attributes('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger);
    wrapper.unmount();
  });
});
