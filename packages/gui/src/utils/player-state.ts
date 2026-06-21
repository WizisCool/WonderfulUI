export type PlayerState = 'loading' | 'playing' | 'paused' | 'buffering' | 'ended' | 'error';

export interface PlayerUI {
  showLoading: boolean;
  showSpinner: boolean;
  showFrameStepper: boolean;
  showReplay: boolean;
  showError: boolean;
  controlsPlaying: boolean;
}

export function deriveUI(state: PlayerState): PlayerUI {
  return {
    showLoading: state === 'loading' || state === 'buffering',
    showSpinner: state === 'loading',
    showFrameStepper: state === 'paused',
    showReplay: state === 'ended',
    showError: state === 'error',
    controlsPlaying: state === 'playing' || state === 'buffering',
  };
}

export type BufferingMode = 'hidden' | 'spinner' | 'dim-overlay';

export const BUFFERING_DEBOUNCE_MS = 300;
export const SEEK_WINDOW_MS = 1000;

export interface CanPlayTransition {
  nextState: PlayerState;
  shouldPlay: boolean;
  clearPendingBuffering: true;
}

export function canPlayTransition(
  state: PlayerState,
  stateBeforeBuffering: PlayerState | null,
): CanPlayTransition {
  if (state === 'loading') {
    return { nextState: 'playing', shouldPlay: true, clearPendingBuffering: true };
  }

  if (state === 'buffering') {
    const nextState = stateBeforeBuffering ?? 'paused';
    return { nextState, shouldPlay: nextState === 'playing', clearPendingBuffering: true };
  }

  return { nextState: state, shouldPlay: false, clearPendingBuffering: true };
}
