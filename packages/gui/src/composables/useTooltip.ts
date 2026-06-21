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

  function show(t: HTMLElement, tipText: string, x: number) {
    clearTimer();
    target = t;
    cursorX = x;
    text.value = tipText;
    const el = ensureElement();
    const body = el.querySelector<HTMLElement>('.tooltip-body');
    if (body) body.textContent = tipText;
    visible.value = true;
    el.classList.add('is-visible');
    const ref = referenceAtX(t, x);
    positionFloating(ref, el);
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
