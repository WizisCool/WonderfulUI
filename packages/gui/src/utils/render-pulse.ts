const DEFAULT_PULSE_MS = 260;
const MIN_PULSE_MS = 80;
const MAX_PULSE_MS = 800;

let pulseElement: HTMLElement | null = null;
let activeAnimation: Animation | null = null;

function shouldPulse(): boolean {
  // Always pulse when DOM is ready — do not gate on OS prefers-reduced-motion
  // (Windows "动画效果" would otherwise skip the WebView2 compositor kick).
  return typeof window !== 'undefined' && !!document.body;
}

function pulseDuration(durationMs: number): number {
  return Math.max(MIN_PULSE_MS, Math.min(MAX_PULSE_MS, Math.round(durationMs)));
}

function ensurePulseElement(): HTMLElement {
  if (pulseElement?.isConnected) return pulseElement;
  pulseElement = document.createElement('div');
  pulseElement.className = 'wui-render-pulse';
  pulseElement.setAttribute('aria-hidden', 'true');
  document.body.append(pulseElement);
  return pulseElement;
}

/**
 * WebView2 can occasionally skip newly-triggered CSS motion after a canvas
 * chart has settled. A tiny compositor pulse gives those animations a short,
 * explicit frame source without keeping a permanent render loop alive.
 */
export function pulseRendererForMotion(durationMs = DEFAULT_PULSE_MS): void {
  if (!shouldPulse()) return;
  const node = ensurePulseElement();
  activeAnimation?.cancel();
  const animation = node.animate([
    { opacity: 0.001, transform: 'translate3d(0, 0, 0)' },
    { opacity: 0.002, transform: 'translate3d(0.01px, 0, 0)' },
    { opacity: 0.001, transform: 'translate3d(0, 0, 0)' },
  ], {
    duration: pulseDuration(durationMs),
    easing: 'linear',
    iterations: 1,
  });
  activeAnimation = animation;
  animation.onfinish = () => {
    if (activeAnimation === animation) activeAnimation = null;
  };
  animation.oncancel = () => {
    if (activeAnimation === animation) activeAnimation = null;
  };
}
