import { ref, onMounted, onUnmounted } from 'vue';
import { positionFloating, createArrow, referenceAtX } from './useFloating.ts';

const TOOLTIP_DELAY_MS = 800;

export function useTooltip() {
  const tooltipEl = ref<HTMLElement | null>(null);
  const visible = ref(false);
  const text = ref('');
  let timer: number | null = null;
  let target: HTMLElement | null = null;
  let cursorX = 0;

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
    // Fallback: if onMounted hasn't run yet (shouldn't happen in
    // App.vue, but defensive), create lazily.
    if (!tooltipEl.value) {
      const el = create();
      document.body.appendChild(el);
      tooltipEl.value = el;
    }
    return tooltipEl.value;
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
    // Force synchronous layout after setting text so computePosition
    // reads fresh dimensions. Without this, a freshly-created
    // tooltip element (or one whose text changed significantly) may
    // not yet have its final offsetWidth when computePosition reads
    // it, causing the first tooltip of the session to appear
    // misaligned relative to the cursor.
    void el.offsetWidth;
    // Await position BEFORE showing the tooltip.  positionFloating
    // calls the async computePosition; without await the tooltip
    // renders at its CSS default (0,0) and then visibly jumps.
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

  return { tooltipEl, visible, text, show, schedule, reposition, hide };
}
