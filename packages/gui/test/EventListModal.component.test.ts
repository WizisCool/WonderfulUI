import { describe, test, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import EventListModal from '../src/components/event/EventListModal.vue';
import type { NormalizedMatchEvent } from '../src/utils/match-events.ts';
import type { VideoItem } from '@wonderful-ui/parser';

function mkVideo(id: string): VideoItem {
  return { video_id: id } as VideoItem;
}

function mkEvent(overrides: Partial<NormalizedMatchEvent> = {}): NormalizedMatchEvent {
  return {
    timeMs: 120000,
    seekMs: 120000,
    playbackSeekMs: 118000,
    type: 'kill',
    video: mkVideo('v1'),
    roundIdx: 0,
    playerName: '敌人甲',
    weaponName: 'AK_Standard',
    isHeadshot: false,
    assistNum: 0,
    rawEvent: { event_id: 'e1', event_sTime: 120000, event_type: 'kill', event_ext: {} },
    isKillerMe: true,
    isKilledMe: false,
    ...overrides,
  };
}

function mountModal(events: NormalizedMatchEvent[], extra: { matchLabel?: string; kills?: number; deaths?: number } = {}) {
  return mount(EventListModal, {
    props: {
      events,
      matchLabel: extra.matchLabel ?? '测试对局',
      kills: extra.kills,
      deaths: extra.deaths,
    },
  });
}

describe('EventListModal', () => {
  test('renders match label', () => {
    const wrapper = mountModal([mkEvent()], { matchLabel: 'My Match' });
    expect(wrapper.text()).toContain('My Match');
  });

  test('renders kills and deaths when provided', () => {
    const wrapper = mountModal([mkEvent()], { kills: 20, deaths: 10 });
    expect(wrapper.text()).toContain('击杀 20');
    expect(wrapper.text()).toContain('阵亡 10');
  });

  test('does not show kill/death header stats when undefined', () => {
    const wrapper = mountModal([mkEvent()]);
    expect(wrapper.find('.event-list-meta-kill').exists()).toBe(false);
  });

  test('renders multiple event rows', () => {
    const events = [mkEvent({ playerName: '敌人甲' }), mkEvent({ playerName: '敌人乙' })];
    const wrapper = mountModal(events);
    expect(wrapper.text()).toContain('敌人甲');
    expect(wrapper.text()).toContain('敌人乙');
  });

  test('emits close on backdrop click', async () => {
    const wrapper = mountModal([mkEvent()]);
    await wrapper.find('.event-list-modal-backdrop').trigger('click');
    expect(wrapper.emitted('close')).toHaveLength(1);
  });

  test('emits close on close button click', async () => {
    const wrapper = mountModal([mkEvent()]);
    await wrapper.find('.event-list-modal-close').trigger('click');
    expect(wrapper.emitted('close')).toHaveLength(1);
  });

  test('renders title', () => {
    const wrapper = mountModal([mkEvent()]);
    expect(wrapper.text()).toContain('本局事件');
  });

  test('renders column headers', () => {
    const wrapper = mountModal([mkEvent()]);
    expect(wrapper.text()).toContain('时间');
    expect(wrapper.text()).toContain('玩家');
  });

  test('handles empty event list', () => {
    const wrapper = mountModal([]);
    expect(wrapper.find('.event-list-modal').exists()).toBe(true);
  });
});
