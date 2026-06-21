import { describe, expect, test } from 'bun:test';
import { canPlayTransition } from '../src/utils/player-state.ts';

describe('canPlayTransition', () => {
  test('clears pending buffering without leaving playing when canplay arrives before debounce fires', () => {
    expect(canPlayTransition('playing', 'playing')).toEqual({
      nextState: 'playing',
      shouldPlay: false,
      clearPendingBuffering: true,
    });
  });

  test('recovers from buffering to the state before buffering and resumes only if it was playing', () => {
    expect(canPlayTransition('buffering', 'playing')).toEqual({
      nextState: 'playing',
      shouldPlay: true,
      clearPendingBuffering: true,
    });

    expect(canPlayTransition('buffering', 'paused')).toEqual({
      nextState: 'paused',
      shouldPlay: false,
      clearPendingBuffering: true,
    });
  });
});
