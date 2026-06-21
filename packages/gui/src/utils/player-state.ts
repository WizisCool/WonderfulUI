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
