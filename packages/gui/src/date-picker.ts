/**
 * Custom dark-theme date range picker.
 *
 * Replaces flatpickr for the dateRange filter. Two reasons:
 *   1. flatpickr's default theme clashes with our warm-dark panel system —
 *      even with !important overrides it doesn't fully read as part of
 *      the UI. The user feedback was explicit: the date picker "feels
 *      style-disjointed".
 *   2. We need a compact trigger button ("选择日期范围" / "2024-01-12 — 2024-12-18")
 *      that fits inside the filter row, not a stacked two-input layout.
 *
 * UX design notes (post-feedback round):
 *
 *   The popover is treated as a CONTINUATION of the trigger, not a
 *   separate floating card. Two principles:
 *
 *   • **Layered hierarchy** — when the popover is open, the trigger
 *     raises to surface-3 with an accent border; the popover below
 *     uses a 1px top border in border-soft to read as a single extended
 *     surface. The multi-layer drop shadow (3 stops, warm-tinted)
 *     signals elevation without using pure black.
 *
 *   • **Interaction continuity** — the popover doesn't fade in: it
 *     emerges from the trigger. transform-origin is set to the trigger
 *     so the popover slides down + scales subtly (0.97→1) with a
 *     180ms ease-out-expo curve. The trigger itself gets a brief
 *     scale-pulse (1→1.02→1, 240ms) so the user feels the connection.
 *     Range hover-preview cells fade between selections rather than
 *     flickering. Day cells get a 0.92→1.08 scale on press for
 *     tactile feedback.
 *
 *   • **State choreography** — the trigger has three visual states
 *     (idle / hover / expanded); the popover shares the accent border
 *     with the trigger so the eye traces the source. The backdrop is
 *     intentionally absent inside the filter popover (no need — the
 *     popover is already in a closed container). When invoked outside
 *     the filter popover the backdrop fades in slower (260ms) so it
 *     doesn't compete with the popover's own entrance.
 */

import { createElement, CalendarDays, X } from 'lucide';

const WEEKDAYS_CN = ['日', '一', '二', '三', '四', '五', '六'];

function pad2(n: number): string { return String(n).padStart(2, '0'); }

function fmtDate(d: Date | null): string {
  if (!d) return '';
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function endOfDay(d: Date): Date {
  const end = startOfDay(d);
  end.setDate(end.getDate() + 1);
  end.setMilliseconds(-1);
  return end;
}

export function endOfSelectedDayForFilter(d: Date): number {
  return endOfDay(d).getTime();
}

/** 6-week grid (always), Sunday-start, for a given (year, month). */
function monthGrid(year: number, month: number): Date[][] {
  const first = new Date(year, month, 1);
  const gridStart = new Date(first);
  gridStart.setDate(first.getDate() - first.getDay());

  const weeks: Date[][] = [];
  for (let w = 0; w < 6; w++) {
    const week: Date[] = [];
    for (let d = 0; d < 7; d++) {
      const day = new Date(gridStart);
      day.setDate(gridStart.getDate() + w * 7 + d);
      week.push(day);
    }
    weeks.push(week);
  }
  return weeks;
}

const MONTH_NAMES = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function inRange(d: Date, start: Date, end: Date): boolean {
  const t = d.getTime();
  return t >= start.getTime() && t <= end.getTime();
}

interface DateRange {
  start: Date | null;
  end: Date | null;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k.startsWith('data-') || k.startsWith('aria-') || k === 'role' || k === 'tabindex' || k === 'type' || k === 'placeholder' || k === 'title' || k === 'aria-label') {
      node.setAttribute(k, v);
    } else {
      (node as unknown as Record<string, unknown>)[k] = v;
    }
  }
  for (const c of children) node.append(c);
  return node;
}

const PRECISION_OUT = 'cubic-bezier(0.16, 1, 0.3, 1)';
const PRECISION_IN  = 'cubic-bezier(0.7, 0, 0.84, 0)';

/**
 * Build the date-range picker. Returns the trigger button; the popover
 * is created lazily on first click and lives on `document.body` so it
 * can escape the filter popover's overflow:hidden container.
 */
export function createDateRangePicker(
  current: [number | null, number | null],
  onChange: (start: number | null, end: number | null) => void,
): HTMLElement {
  const trigger = el('button', {
    class: 'dr-trigger',
    type: 'button',
    'aria-label': '选择日期范围',
    'aria-haspopup': 'dialog',
    'aria-expanded': 'false',
  });

  let range: DateRange = {
    start: current[0] != null ? startOfDay(new Date(current[0])) : null,
    end: current[1] != null ? startOfDay(new Date(current[1])) : null,
  };

  function syncTrigger() {
    trigger.innerHTML = '';
    trigger.append(createElement(CalendarDays, { width: 12, height: 12 }));
    const text = el('span', { class: 'dr-trigger-text' });
    if (range.start && range.end) {
      text.textContent = `${fmtDate(range.start)}  —  ${fmtDate(range.end)}`;
      trigger.classList.add('is-active');
    } else if (range.start) {
      text.textContent = `${fmtDate(range.start)}  —  ?`;
      trigger.classList.add('is-active');
    } else {
      text.textContent = '选择日期范围';
      trigger.classList.remove('is-active');
    }
    trigger.append(text);
    if (range.start || range.end) {
      const clear = el('button', {
        class: 'dr-trigger-clear',
        type: 'button',
        'aria-label': '清除日期范围',
        title: '清除',
      }, [createElement(X, { width: 10, height: 10 })]);
      clear.addEventListener('click', e => {
        e.stopPropagation();
        range = { start: null, end: null };
        onChange(null, null);
        syncTrigger();
        closePopover();
      });
      trigger.append(clear);
    }
  }

  // popover state
  let popover: HTMLElement | null = null;
  let viewYear: number;
  let viewMonth: number;
  let hoverEnd: Date | null = null;  // preview while picking end

  function pulseTrigger() {
    // brief 1→1.02→1 scale to confirm the connection
    trigger.classList.remove('is-pulse');
    // force reflow so the animation can re-trigger
    void trigger.offsetWidth;
    trigger.classList.add('is-pulse');
  }

  function openPopover() {
    if (popover) return;
    // view month = start month if a range is set, else current month
    const seed = range.start ?? new Date();
    viewYear = seed.getFullYear();
    viewMonth = seed.getMonth();

    popover = el('div', {
      class: 'dr-popover',
      role: 'dialog',
      'aria-label': '日期范围',
    });
    // measure hidden, position, then reveal with .is-open
    popover.style.visibility = 'hidden';
    document.body.append(popover);
    renderPopover();
    positionPopover();
    popover.style.visibility = '';
    pulseTrigger();
    trigger.classList.add('is-expanded');
    trigger.setAttribute('aria-expanded', 'true');

    // Esc to close (use capture so it pre-empts app's global handler)
    document.addEventListener('keydown', onKey, true);
    // Outside click to close (mousedown so we beat any in-popover clicks)
    // The popover lives on document.body; mousedown on document with
    // the popover path as a guard.
    setTimeout(() => {
      document.addEventListener('mousedown', onDocDown, true);
    }, 0);

    // reveal on next frame so the entry transition runs
    requestAnimationFrame(() => {
      popover?.classList.add('is-open');
    });
  }

  function closePopover() {
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('mousedown', onDocDown, true);
    trigger.classList.remove('is-expanded');
    trigger.setAttribute('aria-expanded', 'false');
    if (popover) {
      popover.classList.remove('is-open');
      const node = popover;
      popover = null;
      const cleanup = () => node.remove();
      node.addEventListener('transitionend', cleanup, { once: true });
      // safety: if transitionend never fires (e.g. reduced motion
      // collapses duration to 1ms and the listener races), remove
      // after the max transition duration + a small buffer.
      setTimeout(cleanup, 240);
    }
    hoverEnd = null;
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      closePopover();
    }
  }

  function onDocDown(e: MouseEvent) {
    const t = e.target as Node;
    if (popover && !popover.contains(t) && !trigger.contains(t)) {
      closePopover();
    }
  }

  function positionPopover() {
    if (!popover) return;
    const r = trigger.getBoundingClientRect();
    const pw = popover.offsetWidth;
    const ph = popover.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const gap = 4;
    // prefer below; flip above if no room
    let top = r.bottom + gap;
    if (top + ph > vh - 8 && r.top - ph - gap >= 8) top = r.top - ph - gap;
    let left = r.right - pw;  // right-align to the trigger's right edge
    if (left < 8) left = 8;
    if (left + pw > vw - 8) left = vw - pw - 8;
    // Set transform-origin to the trigger's top-center so the
    // entry animation looks like the popover emerged from the trigger.
    const triggerCx = r.left + r.width / 2 - left;
    const triggerTop = r.top - top;
    popover.style.left = `${left}px`;
    popover.style.top = `${top}px`;
    popover.style.setProperty('--dr-origin-x', `${triggerCx}px`);
    popover.style.setProperty('--dr-origin-y', `${triggerTop}px`);
  }

  function renderPopover() {
    if (!popover) return;
    popover.innerHTML = '';

    // header
    popover.append(el('div', { class: 'dr-header' }, [
      el('span', { class: 'dr-title' }, ['日期范围']),
      el('div', { class: 'dr-nav' }, [
        el('button', { class: 'dr-nav-btn', type: 'button', 'aria-label': '上一月' }, ['‹']),
        el('span', { class: 'dr-nav-label' }, [`${viewYear}年  ${MONTH_NAMES[viewMonth]}`]),
        el('button', { class: 'dr-nav-btn', type: 'button', 'aria-label': '下一月' }, ['›']),
      ]),
    ]));
    popover.querySelector<HTMLButtonElement>('.dr-nav-btn:first-child')!
      .addEventListener('click', () => {
        viewMonth -= 1;
        if (viewMonth < 0) { viewMonth = 11; viewYear -= 1; }
        renderPopover();
      });
    popover.querySelector<HTMLButtonElement>('.dr-nav-btn:last-child')!
      .addEventListener('click', () => {
        viewMonth += 1;
        if (viewMonth > 11) { viewMonth = 0; viewYear += 1; }
        renderPopover();
      });

    // weekday row
    const weekdayRow = el('div', { class: 'dr-weekdays' });
    for (const w of WEEKDAYS_CN) weekdayRow.append(el('span', { class: 'dr-weekday' }, [w]));
    popover.append(weekdayRow);

    // month grid
    const grid = el('div', { class: 'dr-grid' });
    const weeks = monthGrid(viewYear, viewMonth);
    for (const week of weeks) {
      for (const day of week) {
        const isOtherMonth = day.getMonth() !== viewMonth;
        const cell = el('button', {
          class: 'dr-day',
          type: 'button',
          'data-time': String(day.getTime()),
        }, [String(day.getDate())]);

        if (isOtherMonth) cell.classList.add('is-other');
        if (isSameDay(day, new Date())) cell.classList.add('is-today');

        // range highlighting
        if (range.start && range.end) {
          if (isSameDay(day, range.start)) cell.classList.add('is-range-start');
          else if (isSameDay(day, range.end)) cell.classList.add('is-range-end');
          else if (inRange(day, range.start, range.end)) cell.classList.add('is-in-range');
        } else if (range.start && !range.end) {
          // start picked, hovering for end
          if (hoverEnd) {
            if (isSameDay(day, range.start)) cell.classList.add('is-range-start');
            else if (isSameDay(day, hoverEnd)) cell.classList.add('is-range-end');
            else {
              const lo = range.start < hoverEnd ? range.start : hoverEnd;
              const hi = range.start < hoverEnd ? hoverEnd : range.start;
              if (inRange(day, lo, hi)) cell.classList.add('is-in-range');
            }
          } else {
            if (isSameDay(day, range.start)) cell.classList.add('is-range-start');
          }
        }

        cell.addEventListener('mouseenter', () => {
          if (range.start && !range.end) {
            hoverEnd = startOfDay(day);
            renderPopover();
          }
        });
        cell.addEventListener('click', e => {
          e.stopPropagation();
          const d = startOfDay(day);
          if (!range.start || (range.start && range.end)) {
            range = { start: d, end: null };
            hoverEnd = null;
            renderPopover();
          } else {
            // picking end
            if (d < range.start) {
              range = { start: d, end: range.start };
            } else {
              range = { start: range.start, end: d };
            }
            hoverEnd = null;
            onChange(
              range.start?.getTime() ?? null,
              range.end ? endOfSelectedDayForFilter(range.end) : null,
            );
            syncTrigger();
            renderPopover();
            // brief settle delay so the user sees their selection
            // before the popover eases away
            setTimeout(closePopover, 200);
          }
        });

        grid.append(cell);
      }
    }
    popover.append(grid);

    // footer
    const footer = el('div', { class: 'dr-footer' });
    if (range.start || range.end) {
      const reset = el('button', { class: 'dr-footer-btn', type: 'button' }, ['清除']);
      reset.addEventListener('click', () => {
        range = { start: null, end: null };
        onChange(null, null);
        syncTrigger();
        renderPopover();
      });
      footer.append(reset);
    }
    const hint = el('span', { class: 'dr-hint' }, [
      range.start && !range.end ? '再点一次选结束日期' : '',
    ]);
    footer.append(hint);
    const close = el('button', { class: 'dr-footer-btn dr-footer-close', type: 'button' }, ['完成']);
    close.addEventListener('click', closePopover);
    footer.append(close);
    popover.append(footer);
  }

  trigger.addEventListener('click', e => {
    e.stopPropagation();
    if (popover) closePopover();
    else openPopover();
  });

  let disposed = false;
  function dispose() {
    if (disposed) return;
    disposed = true;
    window.removeEventListener('resize', onResize);
    cleanupObserver.disconnect();
    closePopover();
  }

  function onResize() {
    if (!trigger.isConnected) {
      dispose();
      return;
    }
    if (popover) positionPopover();
  }

  const cleanupObserver = new MutationObserver(() => {
    if (!trigger.isConnected) dispose();
  });
  cleanupObserver.observe(document.body, { childList: true, subtree: true });

  // Re-position while open, and release the listener after the picker leaves DOM.
  window.addEventListener('resize', onResize);

  syncTrigger();
  return trigger;
}

export { PRECISION_OUT, PRECISION_IN };
