import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { createTestingPinia } from '@pinia/testing';
import { nextTick } from 'vue';
import PlayerHost from '../src/components/player/PlayerHost.vue';
import type { VideoItem, MatchRecord } from '@wonderful-ui/parser';

// Mock @tauri-apps so the Tauri runtime check in tauri-adapter.ts does not
// try to touch window.__TAURI_INTERNALS__ during the player mount.
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async () => undefined),
  convertFileSrc: vi.fn((p: string) => p),
}));
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async () => () => {}),
}));

function mkVideo(): VideoItem {
  return {
    video_id: 'v1',
    video_type: '击杀集锦',
    video_name: '击杀集锦',
    video_duration: 30000,
    video_src: 'D:\\videos\\v1.mp4',
    video_isProcessing: false,
    rounds: [],
  } as unknown as VideoItem;
}

function mkMatch(): MatchRecord {
  return {
    openID: 'test-1',
    matches_id: 'match-001',
    matches_time: 1719000000000,
    map: { map_id: '/Game/Maps/Ascent/Ascent' },
    mode: 'competitive',
    agent: { agent_name: 'Cypher', agent_id: 'cypher-id' },
    stats: { kills: 14, deaths: 12, assists: 5, score: 3200, has_won: true, rounds_won: 13, rounds_lost: 10, mode_name: '', game_level: '' },
    minRoundId: 0,
    gameStartTime: '2026-06-08 18:00:00',
    gameEndTime: '2026-06-08 18:35:00',
    videos: [],
  } as unknown as MatchRecord;
}

function mountPlayer() {
  const video = mkVideo();
  const match = mkMatch();
  return mount(PlayerHost, {
    attachTo: document.body,
    global: {
      plugins: [
        createTestingPinia({
          createSpy: vi.fn,
          stubActions: false,
          initialState: {
            player: { video, matchContext: match, seekMs: undefined, isOpen: true },
            ui: { toasts: [], scrapeProgress: null },
          },
        }),
      ],
    },
  });
}

describe('PlayerHost context menu', () => {
  let wrapper: ReturnType<typeof mountPlayer>;

  beforeEach(() => {
    wrapper = mountPlayer();
  });
  afterEach(() => {
    wrapper.unmount();
  });

  test('right-click on stage opens the menu with enter animation class', async () => {
    const stage = wrapper.find('.player-stage');
    expect(stage.exists()).toBe(true);

    await stage.trigger('contextmenu', { clientX: 200, clientY: 150 });
    await nextTick();

    const menu = document.querySelector('.player-context-menu');
    expect(menu).toBeTruthy();
    // The enter animation must be applied — i.e. the element exists with
    // its own `animation` rule. v-show keeps it in the DOM so we can read
    // the class on the same element.
    expect(menu?.classList.contains('is-closing')).toBe(false);
  });

  test('opening does not immediately close from the right-click click', async () => {
    // Reproduce the original race: a right-click fires
    //   mousedown → mouseup → click (button=2) → contextmenu
    // Before the fix, the doc-level `click` handler saw the synthesized
    // click *after* contextmenu, treated its target as "outside the menu"
    // (correct — the click target is .player-stage, not the menu), and
    // closed the menu in the same frame. Pin the fix: that same click
    // must NOT close the menu.
    const stage = wrapper.find('.player-stage');

    await stage.trigger('contextmenu', { clientX: 200, clientY: 150 });
    await nextTick();

    // Dispatch the click that follows contextmenu on the same target.
    const click = new MouseEvent('click', { bubbles: true, button: 2 });
    stage.element.dispatchEvent(click);
    await nextTick();

    const menu = document.querySelector('.player-context-menu');
    expect(menu).toBeTruthy();
    expect(menu?.classList.contains('is-closing')).toBe(false);
  });

  test('left mousedown outside the menu starts the close animation', async () => {
    const stage = wrapper.find('.player-stage');
    await stage.trigger('contextmenu', { clientX: 200, clientY: 150 });
    await nextTick();

    // A real left-mousedown on document.body (outside the menu) must
    // close the menu. The handler uses capture phase + button === 0.
    const outside = new MouseEvent('mousedown', { bubbles: true, button: 0 });
    document.body.dispatchEvent(outside);
    await nextTick();

    const menu = document.querySelector('.player-context-menu');
    expect(menu).toBeTruthy();
    expect(menu?.classList.contains('is-closing')).toBe(true);
  });

  test('right-mousedown outside does not close the menu', async () => {
    const stage = wrapper.find('.player-stage');
    await stage.trigger('contextmenu', { clientX: 200, clientY: 150 });
    await nextTick();

    // button=2 (right) mousedown must be ignored — only left closes.
    const right = new MouseEvent('mousedown', { bubbles: true, button: 2 });
    document.body.dispatchEvent(right);
    await nextTick();

    const menu = document.querySelector('.player-context-menu');
    expect(menu?.classList.contains('is-closing')).toBe(false);
  });

  test('animationend with the out keyframe finishes closing', async () => {
    const stage = wrapper.find('.player-stage');
    await stage.trigger('contextmenu', { clientX: 200, clientY: 150 });
    await nextTick();

    // Trigger the close path.
    const outside = new MouseEvent('mousedown', { bubbles: true, button: 0 });
    document.body.dispatchEvent(outside);
    await nextTick();

    const menu = document.querySelector('.player-context-menu')!;
    expect(menu.classList.contains('is-closing')).toBe(true);

    // Synthesize the animationend for the out keyframe. The handler must
    // only react to its own keyframe name to ignore bubbled descendant
    // animation events.
    const end = new AnimationEvent('animationend', { bubbles: true, animationName: 'player-ctxmenu-out' });
    menu.dispatchEvent(end);
    await nextTick();

    // v-show with ref still in DOM but data reactive should be false now.
    // We can't easily read the data flag, but the menu is no longer
    // marked closing and will be hidden by the safety timeout.
    expect(menu.classList.contains('is-closing')).toBe(false);
  });
});
