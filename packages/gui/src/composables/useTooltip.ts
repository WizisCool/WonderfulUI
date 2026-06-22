import { ref, onUnmounted } from 'vue';
import { positionFloating, createArrow, referenceAtX } from './useFloating.ts';

const TOOLTIP_DELAY_MS = 800;

export function useTooltip() {
  const tooltipEl = ref<HTMLElement | null>(null);
  const visible = ref(false);
  const text = ref('');
  let timer: number | null = null;
  let target: HTMLElement | null = null;
  let cursorX = 0;

  function ensureElement(): HTMLElement {
    if (tooltipEl.value) return tooltipEl.value;
    const el = document.createElement('div');
    el.className = 'tooltip';
    el.setAttribute('role', 'tooltip');
    const body = document.createElement('span');
    body.className = 'tooltip-body';
    el.appendChild(body);
    el.appendChild(createArrow());
    document.body.appendChild(el);
    tooltipEl.value = el;
    return el;
  }

  async function show(t: HTMLElement, tipText: string, x: number) {
    clearTimer();
    // Bail if the target left the DOM while the schedule timer was
    // running — computePosition would fail on a disconnected element.
    if (!t.isConnected) return;
    target = t;
    cursorX = x;
    text.value = tipText;
    const el = ensureElement();
    const body = el.querySelector<HTMLElement>('.tooltip-body');
    if (body) body.textContent = tipText;
    // Await position BEFORE showing the tooltip.  positionFloating
    // calls the async computePosition which can take 300-600 ms;
    // without await the tooltip renders at its CSS default (0,0)
    // and then visibly jumps to the computed location.
    const ref = referenceAtX(t, x);
    await positionFloating(ref, el);
    // Re-check connectedness after the async gap.
    if (!t.isConnected) return;
    // If `hide()` was called during the await (e.g. the user moved
    // the mouse away while computePosition was running), don't
    // re-show the tooltip.
    if (target !== t) return;
    visible.value = true;
    el.classList.add('is-visible');
  }

  function schedule(t: HTMLElement, tipText: string, x: number) {
    clearTimer();
    target = t;
    cursorX = x;
    timer = window.setTimeout(() => {
      timer = null;
      show(t, tipText, x);
    }, TOOLTIP_DELAY_MS);
  }

  function reposition(x: number) {
    cursorX = x;
    if (!visible.value || !target || !tooltipEl.value) return;
    const ref = referenceAtX(target, x);
    positionFloating(ref, tooltipEl.value);
  }

  function hide() {
    clearTimer();
    target = null;
    visible.value = false;
    tooltipEl.value?.classList.remove('is-visible');
  }

  function clearTimer() {
    if (timer != null) { clearTimeout(timer); timer = null; }
  }

  onUnmounted(() => {
    clearTimer();
    tooltipEl.value?.remove();
  });

  return { tooltipEl, visible, text, show, schedule, reposition, hide };
}
