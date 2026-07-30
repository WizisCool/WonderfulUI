import { describe, expect, test } from 'vitest';
import { mount } from '@vue/test-utils';
import PlayerControls from '../src/components/player/PlayerControls.vue';

function mountControls(volumeLevel = 40) {
  return mount(PlayerControls, {
    props: {
      playing: false,
      currentTimeStr: '0:00',
      durationStr: '1:00',
      currentTime: 0,
      duration: 60,
      volumeLevel,
      volumeMuted: false,
      video: null,
      match: null,
      bufferedStyle: {},
    },
  });
}

describe('PlayerControls volume slider', () => {
  test('ignores pointer input while responsive layout gives the track zero width', async () => {
    const wrapper = mountControls();
    const track = wrapper.get('.player-vol-track');
    (track.element as HTMLElement).getBoundingClientRect = () => ({
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

    await track.trigger('mousedown', { button: 0, clientX: 10 });

    expect(wrapper.emitted('volumeChange')).toBeUndefined();
    wrapper.unmount();
  });

  test('exposes bounded keyboard slider behavior', async () => {
    const wrapper = mountControls();
    const track = wrapper.get('.player-vol-track');

    expect(track.attributes('role')).toBe('slider');
    expect(track.attributes('aria-valuenow')).toBe('40');
    await track.trigger('keydown', { key: 'ArrowRight' });
    await track.trigger('keydown', { key: 'Home' });
    await track.trigger('keydown', { key: 'End' });

    expect(wrapper.emitted('volumeChange')).toEqual([[45], [0], [100]]);
    wrapper.unmount();
  });
});
