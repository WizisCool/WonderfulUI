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
 * UX design notes:
 *
 *   This is a compact filter-rail control, not a modal or standalone
 *   date-picker card. Keep it visually aligned with filter chips and
 *   numeric inputs: low elevation, token colors, clear focus, no shadow.
 */

import { createElement, CalendarDays, ChevronLeft, ChevronRight, X } from 'lucide';

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

function rangeFromTuple(current: [number | null, number | null]): DateRange {
  return {
    start: current[0] != null ? startOfDay(new Date(current[0])) : null,
    end: current[1] != null ? startOfDay(new Date(current[1])) : null,
  };
}

function cloneRange(r: DateRange): DateRange {
  return {
    start: r.start ? new Date(r.start) : null,
    end: r.end ? new Date(r.end) : null,
  };
}

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

  let appliedRange: DateRange = rangeFromTuple(current);
  let draftRange: DateRange = cloneRange(appliedRange);

  function syncTrigger() {
    trigger.innerHTML = '';
    trigger.append(createElement(CalendarDays, { width: 12, height: 12 }));
    const text = el('span', { class: 'dr-trigger-text' });
    if (appliedRange.start && appliedRange.end) {
      text.textContent = `${fmtDate(appliedRange.start)}  —  ${fmtDate(appliedRange.end)}`;
      trigger.classList.add('is-active');
    } else {
      text.textContent = '选择日期范围';
      trigger.classList.remove('is-active');
    }
    trigger.append(text);
    if (appliedRange.start || appliedRange.end) {
      const clear = el('button', {
        class: 'dr-trigger-clear',
        type: 'button',
        'aria-label': '清除日期范围',
        title: '清除',
      }, [createElement(X, { width: 10, height: 10 })]);
      clear.addEventListener('click', e => {
        e.stopPropagation();
        appliedRange = { start: null, end: null };
        draftRange = cloneRange(appliedRange);
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

  function openPopover() {
    if (popover) return;
    draftRange = cloneRange(appliedRange);
    const seed = draftRange.start ?? new Date();
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
  }

  function applyDraftRange() {
    if (!draftRange.start && !draftRange.end) {
      appliedRange = { start: null, end: null };
      onChange(null, null);
    } else {
      const start = draftRange.start ?? draftRange.end!;
      const end = draftRange.end ?? draftRange.start!;
      appliedRange = start <= end
        ? { start, end }
        : { start: end, end: start };
      onChange(
        appliedRange.start?.getTime() ?? null,
        appliedRange.end ? endOfSelectedDayForFilter(appliedRange.end) : null,
      );
    }
    draftRange = cloneRange(appliedRange);
    syncTrigger();
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
        el('button', { class: 'dr-nav-btn', type: 'button', 'aria-label': '上一月' }, [
          createElement(ChevronLeft, { width: 14, height: 14 }),
        ]),
        el('span', { class: 'dr-nav-label' }, [`${viewYear}年  ${MONTH_NAMES[viewMonth]}`]),
        el('button', { class: 'dr-nav-btn', type: 'button', 'aria-label': '下一月' }, [
          createElement(ChevronRight, { width: 14, height: 14 }),
        ]),
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
        }, [
          el('span', { class: 'dr-day-num' }, [String(day.getDate())]),
        ]);

        if (isOtherMonth) cell.classList.add('is-other');
        if (isSameDay(day, new Date())) cell.classList.add('is-today');

        // range highlighting
        if (draftRange.start && draftRange.end) {
          if (isSameDay(day, draftRange.start)) cell.classList.add('is-range-start');
          else if (isSameDay(day, draftRange.end)) cell.classList.add('is-range-end');
          else if (inRange(day, draftRange.start, draftRange.end)) cell.classList.add('is-in-range');
        } else if (draftRange.start && !draftRange.end) {
          if (isSameDay(day, draftRange.start)) cell.classList.add('is-range-start');
        }

        cell.addEventListener('click', e => {
          e.stopPropagation();
          const d = startOfDay(day);
          if (!draftRange.start || (draftRange.start && draftRange.end)) {
            draftRange = { start: d, end: null };
            renderPopover();
          } else {
            // picking end
            if (d < draftRange.start) {
              draftRange = { start: d, end: draftRange.start };
            } else {
              draftRange = { start: draftRange.start, end: d };
            }
            renderPopover();
          }
        });

        grid.append(cell);
      }
    }
    popover.append(grid);

    // footer
    const footer = el('div', { class: 'dr-footer' });
    if (draftRange.start || draftRange.end) {
      const reset = el('button', { class: 'dr-footer-btn', type: 'button' }, ['清除']);
      reset.addEventListener('click', () => {
        draftRange = { start: null, end: null };
        renderPopover();
      });
      footer.append(reset);
    }
    const hint = el('span', { class: 'dr-hint' }, [
      draftRange.start && !draftRange.end ? '再点一次选结束日期' : '',
    ]);
    footer.append(hint);
    const close = el('button', { class: 'dr-footer-btn dr-footer-close', type: 'button' }, ['完成']);
    close.addEventListener('click', () => {
      applyDraftRange();
      closePopover();
    });
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
