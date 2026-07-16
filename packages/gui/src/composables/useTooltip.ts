import { ref, onMounted, onUnmounted } from 'vue';
import { positionFloating, createArrow, referenceAtX } from './useFloating.ts';

const TOOLTIP_DELAY_MS = 800;

/** Skip tips on collapsed / zero-size / aria-hidden hosts (expand panels). */
export function isTipEligible(el: HTMLElement): boolean {
  if (!el.isConnected || !el.dataset.tip) return false;
  if (el.closest('[aria-hidden="true"]')) return false;
  const rect = el.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return false;
  const style = getComputedStyle(el);
  if (style.visibility === 'hidden' || style.pointerEvents === 'none') return false;
  return true;
}

export function useTooltip() {
  const tooltipEl = ref<HTMLElement | null>(null);
  const visible = ref(false);
  const text = ref('');
  let timer: number | null = null;
  let target: HTMLElement | null = null;
  let cursorX = 0;
  let cursorY = 0;
  let showGeneration = 0;

  // Create the tooltip element eagerly, not lazily.  When it is
  // created lazily on the first show(), computePosition reads its
  // dimensions while the element hasn't had a full render pass —
  // this can return stale offsetWidth/offsetHeight and cause the
  // first tooltip to be mispositioned.
  function create(): HTMLElement {
    const el = document.createElement('div');
    el.className = 'tooltip';
    el.setAttribute('role', 'tooltip');
    const body = document.createElement('span');
    body.className = 'tooltip-body';
    el.appendChild(body);
    el.appendChild(createArrow());
    return el;
  }

  onMounted(() => {
    const el = create();
    document.body.appendChild(el);
    tooltipEl.value = el;
  });

  onUnmounted(() => {
    clearTimer();
    tooltipEl.value?.remove();
    tooltipEl.value = null;
  });

  function ensureElement(): HTMLElement {
    if (!tooltipEl.value) {
      const el = create();
      document.body.appendChild(el);
      tooltipEl.value = el;
    }
    return tooltipEl.value;
  }

  async function place(t: HTMLElement, el: HTMLElement, x: number) {
    const ref = referenceAtX(t, x);
    await positionFloating(ref, el);
  }

  async function show(t: HTMLElement, tipText: string, x: number) {
    clearTimer();
    if (!isTipEligible(t)) return;

    const gen = ++showGeneration;
    target = t;
    cursorX = x;
    text.value = tipText;

    const el = ensureElement();
    const body = el.querySelector<HTMLElement>('.tooltip-body');
    if (body) body.textContent = tipText;

    // Measure while fully laid out but invisible and free of entrance
    // animation transforms (scale/translate would skew getBoundingClientRect).
    el.classList.remove('is-visible');
    el.classList.add('is-measuring');
    // Force layout after text + measuring class so first computePosition
    // reads final width/height (Chinese font metrics, max-width wrap).
    void el.offsetWidth;
    if (document.fonts?.status === 'loading') {
      try { await document.fonts.ready; } catch { /* ignore */ }
    }
    if (gen !== showGeneration || target !== t || !t.isConnected) return;

    await place(t, el, cursorX);
    if (gen !== showGeneration || target !== t || !t.isConnected) return;

    el.classList.remove('is-measuring');
    visible.value = true;
    el.classList.add('is-visible');

    // Second pass after paint: catches font swap / first-frame size lag
    // that left/top from the pre-show measure can miss. Mousemove used
    // to be the only way users "fixed" this.
    requestAnimationFrame(() => {
      if (gen !== showGeneration || !visible.value || target !== t || !t.isConnected) return;
      void place(t, el, cursorX).then(() => {
        if (gen !== showGeneration || !visible.value || target !== t) return;
        requestAnimationFrame(() => {
          if (gen !== showGeneration || !visible.value || target !== t || !t.isConnected) return;
          void place(t, el, cursorX);
        });
      });
    });
  }

  function schedule(t: HTMLElement, tipText: string, x: number) {
    if (!isTipEligible(t)) return;
    clearTimer();
    target = t;
    cursorX = x;
    timer = window.setTimeout(() => {
      timer = null;
      // Use latest cursorX tracked during the delay, not the stale hover x.
      void show(t, tipText, cursorX);
    }, TOOLTIP_DELAY_MS);
  }

  /** Keep cursor position fresh during the delay and while the tip is open. */
  function trackCursor(x: number, y?: number) {
    cursorX = x;
    if (y != null) cursorY = y;
  }

  function reposition(x: number) {
    cursorX = x;
    if (!visible.value || !target || !tooltipEl.value) return;
    // Host may have collapsed (frame dock tools) while tip still open.
    if (!isTipEligible(target)) {
      hide();
      return;
    }
    void place(target, tooltipEl.value, x);
  }

  function hide() {
    clearTimer();
    showGeneration += 1;
    target = null;
    visible.value = false;
    if (tooltipEl.value) {
      tooltipEl.value.classList.remove('is-visible', 'is-measuring');
    }
  }

  /**
   * After layout changes (e.g. frame dock expand under a stationary cursor),
   * drop the stale tip and reschedule for whatever is under the pointer now.
   */
  function retargetFromCursor() {
    hide();
    const under = document.elementFromPoint(cursorX, cursorY) as HTMLElement | null;
    if (!under) return;
    const el = under.closest('[data-tip]') as HTMLElement | null;
    if (!el?.dataset.tip || !isTipEligible(el)) return;
    schedule(el, el.dataset.tip, cursorX);
  }

  function clearTimer() {
    if (timer != null) { clearTimeout(timer); timer = null; }
  }

  return {
    tooltipEl, visible, text,
    show, schedule, trackCursor, reposition, hide, retargetFromCursor,
  };
}
