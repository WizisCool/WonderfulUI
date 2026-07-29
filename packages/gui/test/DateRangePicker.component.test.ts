import { describe, expect, test } from 'vitest';
import { mount } from '@vue/test-utils';
import DateRangePicker from '../src/components/match/DateRangePicker.vue';

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
});
