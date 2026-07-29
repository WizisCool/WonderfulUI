import { describe, expect, test } from 'bun:test';
import {
  MODAL_LAYER_SELECTOR,
  ownsTopModalLayer,
  topModalLayer,
  type ModalLayer,
} from '../src/utils/modal-layer.ts';

function rootWith(...open: ModalLayer[]): ParentNode {
  const selectors = new Set(open.map(layer => MODAL_LAYER_SELECTOR[layer]));
  return {
    querySelector(selector: string) {
      return selectors.has(selector) ? ({}) : null;
    },
  } as unknown as ParentNode;
}

describe('modal keyboard ownership', () => {
  test('matches the visual z-order instead of listener registration order', () => {
    const root = rootWith('event', 'player', 'settings', 'update', 'share');
    expect(topModalLayer(root)).toBe('share');
    expect(ownsTopModalLayer('share', root)).toBe(true);
    expect(ownsTopModalLayer('player', root)).toBe(false);
  });

  test('player owns keys above the event list but below app dialogs', () => {
    expect(topModalLayer(rootWith('event', 'player'))).toBe('player');
    expect(topModalLayer(rootWith('event', 'player', 'settings'))).toBe('settings');
    expect(topModalLayer(rootWith('event'))).toBe('event');
    expect(topModalLayer(rootWith())).toBeNull();
  });
});
