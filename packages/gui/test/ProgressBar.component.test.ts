import { describe, expect, test, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import ProgressBar from '../src/components/player/ProgressBar.vue';

function mountProgress() {
  const wrapper = mount(ProgressBar, {
    props: {
      currentTime: 20,
      duration: 100,
      currentTimeStr: '0:20',
      durationStr: '1:40',
      bufferedStyle: { transform: 'scaleX(0.5)' },
      video: null,
      match: null,
    },
  });
  const track = wrapper.find('.player-progress-track').element as HTMLElement;
  track.getBoundingClientRect = () => ({
    x: 10,
    y: 0,
    left: 10,
    right: 210,
    top: 0,
    bottom: 4,
    width: 200,
    height: 4,
    toJSON: () => ({}),
  });
  return wrapper;
}

describe('ProgressBar drag lifecycle', () => {
  test('reports start, continuous seeks, and end to the player host', async () => {
    const wrapper = mountProgress();
    await wrapper.find('.player-progress-wrap').trigger('mousedown', {
      button: 0,
      clientX: 50,
    });
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 150 }));
    document.dispatchEvent(new MouseEvent('mouseup'));

    expect(wrapper.emitted('seekStart')).toHaveLength(1);
    expect(wrapper.emitted('seekEnd')).toHaveLength(1);
    expect(wrapper.emitted('seek')).toEqual([[0.2], [0.7]]);
    wrapper.unmount();
  });

  test('ends the drag and removes global listeners when unmounted', async () => {
    const removeListener = vi.spyOn(document, 'removeEventListener');
    const wrapper = mountProgress();
    await wrapper.find('.player-progress-wrap').trigger('mousedown', {
      button: 0,
      clientX: 50,
    });
    wrapper.unmount();
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 150 }));

    expect(wrapper.emitted('seekEnd')).toHaveLength(1);
    expect(removeListener).toHaveBeenCalledWith('mousemove', expect.any(Function));
    expect(removeListener).toHaveBeenCalledWith('mouseup', expect.any(Function));
    removeListener.mockRestore();
  });

  test('ignores pointer input while the responsive track has zero width', async () => {
    const wrapper = mountProgress();
    const track = wrapper.get('.player-progress-track').element as HTMLElement;
    track.getBoundingClientRect = () => ({
      x: 10,
      y: 0,
      left: 10,
      right: 10,
      top: 0,
      bottom: 4,
      width: 0,
      height: 4,
      toJSON: () => ({}),
    });

    await wrapper.get('.player-progress-wrap').trigger('mousedown', {
      button: 0,
      clientX: 10,
    });

    expect(wrapper.emitted('seekStart')).toBeUndefined();
    expect(wrapper.emitted('seek')).toBeUndefined();
    wrapper.unmount();
  });

  test('clamps visual and ARIA state to finite media bounds', async () => {
    const wrapper = mountProgress();
    await wrapper.setProps({ currentTime: 250, duration: 100 });
    const slider = wrapper.get('.player-progress-wrap');
    expect(slider.attributes('aria-valuenow')).toBe('100');
    expect(slider.attributes('aria-valuemax')).toBe('100');
    expect(wrapper.get('.player-progress-fill').attributes('style')).toContain('scaleX(1)');
    expect(wrapper.get('.player-progress-thumb').attributes('style')).toContain('left: 100%');

    await wrapper.setProps({ currentTime: Number.POSITIVE_INFINITY, duration: Number.NaN });
    expect(slider.attributes('aria-valuenow')).toBe('0');
    expect(slider.attributes('aria-valuemax')).toBe('0');
    expect(wrapper.get('.player-progress-fill').attributes('style')).toContain('scaleX(0)');
    wrapper.unmount();
  });
});
