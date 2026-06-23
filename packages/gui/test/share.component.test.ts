import { describe, test, expect, vi } from 'vitest';
import { listAvailablePlatforms, openShareMenu } from '../src/share/index.ts';
import { sharePlatforms } from '../src/share/registry.ts';

describe('share center framework', () => {
  test('registry exposes the lan-qr platform (the only one implemented so far)', () => {
    const keys = Object.keys(sharePlatforms);
    expect(keys).toEqual(['lan-qr']);
    const p = sharePlatforms['lan-qr']!;
    expect(p.id).toBe('lan-qr');
    expect(p.label).toContain('快传');
  });

  test('listAvailablePlatforms returns the lan-qr platform when available', () => {
    const platforms = listAvailablePlatforms();
    expect(platforms.length).toBeGreaterThan(0);
    expect(platforms.some((p) => p.id === 'lan-qr')).toBe(true);
  });

  test('openShareMenu on lan-qr does NOT auto-call share (PlayerHost opens modal first)', async () => {
    // lan-qr 平台不直接调 share() —— PlayerHost 看到 id === 'lan-qr'
    // 时直接弹 ShareModal。所以 openShareMenu 在没有 popover 渲染时
    // 对 lan-qr 平台也无操作（onResult 不会被调）。
    // 这个测试只验证：调用 openShareMenu 不会 throw。
    const fakeAnchor = document.createElement('button');
    const onResult = vi.fn();
    expect(() =>
      openShareMenu(
        fakeAnchor,
        { videoPath: 'D:\\v.mp4', videoName: 'v.mp4' },
        { onResult },
      ),
    ).not.toThrow();
  });

  test('openShareMenu without onResult does not throw', () => {
    const fakeAnchor = document.createElement('button');
    expect(() =>
      openShareMenu(fakeAnchor, { videoPath: 'D:\\v.mp4', videoName: 'v.mp4' }),
    ).not.toThrow();
  });
});

describe('ShareModal Esc handling', () => {
  test('Esc keydown on document should trigger a document-level keydown event', () => {
    // 我们不挂载真实的 ShareModal（要起 server）—— 只验证 happy-dom
    // 的 keydown 事件能 dispatch。这是 Esc 处理逻辑依赖的最低要求。
    let captured: KeyboardEvent | null = null;
    const handler = (e: KeyboardEvent) => {
      captured = e;
    };
    document.addEventListener('keydown', handler, true);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    document.removeEventListener('keydown', handler, true);
    expect(captured).not.toBeNull();
    expect((captured as KeyboardEvent | null)?.key).toBe('Escape');
  });
});
