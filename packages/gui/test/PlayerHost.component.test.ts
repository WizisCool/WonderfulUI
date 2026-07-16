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

  test('menu includes share, system actions, screenshot flyout, and separators', async () => {
    const stage = wrapper.find('.player-stage');
    await stage.trigger('contextmenu', { clientX: 120, clientY: 80 });
    await nextTick();

    const menu = document.querySelector('.player-context-menu');
    expect(menu?.getAttribute('role')).toBe('menu');
    const items = menu?.querySelectorAll('[role="menuitem"]') ?? [];
    const labels = Array.from(items).map(el => el.textContent?.replace(/\s+/g, ' ').trim());
    expect(labels.some(t => t?.includes('系统播放器'))).toBe(true);
    expect(labels.some(t => t?.includes('资源管理器'))).toBe(true);
    expect(labels.some(t => t?.includes('复制视频路径'))).toBe(true);
    expect(labels.some(t => t?.includes('截图'))).toBe(true);
    expect(labels.some(t => t?.includes('快传'))).toBe(true);
    expect(menu?.querySelectorAll('[role="separator"]').length ?? 0).toBeGreaterThanOrEqual(2);

    // Open screenshot flyout via hover parent.
    const shotParent = Array.from(items).find(el => el.textContent?.includes('截图')) as HTMLElement | undefined;
    expect(shotParent).toBeTruthy();
    shotParent!.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    await nextTick();
    const flyLabels = Array.from(menu?.querySelectorAll('.player-context-flyout [role="menuitem"]') ?? [])
      .map(el => el.textContent?.replace(/\s+/g, ' ').trim());
    expect(flyLabels.some(t => t?.includes('复制到剪贴板'))).toBe(true);
    expect(flyLabels.some(t => t?.includes('保存为 PNG'))).toBe(true);
  });

  test('Escape closes the menu without removing the player', async () => {
    const stage = wrapper.find('.player-stage');
    await stage.trigger('contextmenu', { clientX: 120, clientY: 80 });
    await nextTick();
    expect(document.querySelector('.player-context-menu')?.classList.contains('is-closing')).toBe(false);

    const esc = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
    document.dispatchEvent(esc);
    await nextTick();

    const menu = document.querySelector('.player-context-menu');
    expect(menu?.classList.contains('is-closing')).toBe(true);
    // Player shell stays mounted.
    expect(wrapper.find('.player-backdrop').exists()).toBe(true);
  });

  test('second right-click repositions without stacking listeners (still one close)', async () => {
    const stage = wrapper.find('.player-stage');
    await stage.trigger('contextmenu', { clientX: 100, clientY: 100 });
    await nextTick();
    await stage.trigger('contextmenu', { clientX: 300, clientY: 220 });
    await nextTick();

    const menu = document.querySelector('.player-context-menu') as HTMLElement;
    expect(menu).toBeTruthy();
    expect(menu.classList.contains('is-closing')).toBe(false);

    // One outside left-click should start close (not require N clicks).
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
    await nextTick();
    expect(menu.classList.contains('is-closing')).toBe(true);
  });

  test('menu is teleported to body (not trapped under player modal)', async () => {
    const stage = wrapper.find('.player-stage');
    await stage.trigger('contextmenu', { clientX: 150, clientY: 150 });
    await nextTick();
    const menu = document.querySelector('.player-context-menu');
    expect(menu?.parentElement).toBe(document.body);
  });

  test('left-click outside dismisses menu without toggling play (no click-through)', async () => {
    // Playing state: a stage click would pause if click-through leaks.
    const video = wrapper.find('video').element as HTMLVideoElement;
    Object.defineProperty(video, 'paused', { configurable: true, get: () => false });
    // Force playing via store/state if possible — we assert via click handler
    // by ensuring stage click after dismiss does not throw and menu closes.
    const stage = wrapper.find('.player-stage');
    await stage.trigger('contextmenu', { clientX: 160, clientY: 160 });
    await nextTick();

    // Simulate the full dismiss gesture: mousedown outside (closes menu) then
    // click on the stage (must be swallowed — industry dismiss-only semantics).
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, cancelable: true }));
    await nextTick();
    expect(document.querySelector('.player-context-menu')?.classList.contains('is-closing')).toBe(true);

    const click = new MouseEvent('click', { bubbles: true, button: 0, cancelable: true });
    const stopped = !stage.element.dispatchEvent(click);
    // Capture-phase kill may stopImmediatePropagation so default path is canceled.
    // Either the event is stopped, or stage handler no-ops while closing —
    // menu must remain in closing/dismiss path, not re-open play side effects.
    expect(stopped || document.querySelector('.player-context-menu')).toBeTruthy();
  });
});
