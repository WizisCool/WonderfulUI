<template>
  <button
    ref="triggerRef"
    class="dr-trigger"
    :class="{ 'is-active': hasRange, 'is-expanded': isOpen }"
    type="button"
    aria-label="选择日期范围"
    aria-haspopup="dialog"
    :aria-expanded="String(isOpen)"
    @click.stop="toggle"
  >
    <CalendarDays :size="12" />
    <span class="dr-trigger-text">{{ triggerText }}</span>
    <button
      v-if="hasRange"
      class="dr-trigger-clear"
      type="button"
      aria-label="清除日期范围"
      title="清除"
      @click.stop="clearRange"
    >
      <X :size="10" />
    </button>
  </button>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { CalendarDays, X, ChevronLeft, ChevronRight } from 'lucide-vue-next';

const props = defineProps<{
  modelValue: [number | null, number | null];
}>();

const emit = defineEmits<{
  'update:modelValue': [range: [number | null, number | null]];
}>();

const triggerRef = ref<HTMLButtonElement | null>(null);
const isOpen = ref(false);
const viewDate = ref(new Date());
let draftRange: { start: Date | null; end: Date | null } = { start: null, end: null };
let popover: HTMLElement | null = null;

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
const MONTHS = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];

const hasRange = computed(() => props.modelValue[0] !== null || props.modelValue[1] !== null);

const triggerText = computed(() => {
  const [lo, hi] = props.modelValue;
  if (lo != null && hi != null) return `${fmtDate(new Date(lo))}  —  ${fmtDate(new Date(hi))}`;
  return '选择日期范围';
});

function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function pad2(n: number): string { return String(n).padStart(2, '0'); }

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function endOfDay(d: Date): Date {
  const end = startOfDay(d);
  end.setDate(end.getDate() + 1);
  end.setMilliseconds(-1);
  return end;
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function inRange(d: Date, start: Date, end: Date): boolean {
  const t = d.getTime();
  return t >= start.getTime() && t <= end.getTime();
}

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

function initDraft() {
  const [lo, hi] = props.modelValue;
  draftRange = {
    start: lo != null ? startOfDay(new Date(lo)) : null,
    end: hi != null ? startOfDay(new Date(hi)) : null,
  };
}

function toggle() {
  if (isOpen.value) closePopover();
  else openPopover();
}

function openPopover() {
  if (popover) return;
  initDraft();
  const seed = draftRange.start ?? new Date();
  viewDate.value = new Date(seed);

  popover = document.createElement('div');
  popover.className = 'dr-popover';
  popover.setAttribute('role', 'dialog');
  popover.setAttribute('aria-label', '日期范围');
  popover.style.visibility = 'hidden';
  document.body.appendChild(popover);

  render();
  position();
  popover.style.visibility = '';
  isOpen.value = true;

  setTimeout(() => {
    document.addEventListener('mousedown', onDocDown, true);
  }, 0);
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', onResize);

  requestAnimationFrame(() => {
    popover?.classList.add('is-open');
  });
}

function closePopover() {
  document.removeEventListener('keydown', onKey, true);
  document.removeEventListener('mousedown', onDocDown, true);
  window.removeEventListener('resize', onResize);
  isOpen.value = false;
  if (popover) {
    popover.classList.remove('is-open');
    const node = popover;
    popover = null;
    const cleanup = () => node.remove();
    node.addEventListener('transitionend', cleanup, { once: true });
    setTimeout(cleanup, 240);
  }
}

function applyDraft() {
  if (!draftRange.start && !draftRange.end) {
    emit('update:modelValue', [null, null]);
  } else {
    const start = draftRange.start ?? draftRange.end!;
    const end = draftRange.end ?? draftRange.start!;
    const ordered = start <= end ? { start, end } : { start: end, end: start };
    emit('update:modelValue', [
      ordered.start?.getTime() ?? null,
      ordered.end ? endOfDay(ordered.end).getTime() : null,
    ]);
  }
  initDraft();
  closePopover();
}

function clearRange() {
  draftRange = { start: null, end: null };
  emit('update:modelValue', [null, null]);
  closePopover();
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') { e.stopPropagation(); closePopover(); }
}

function onDocDown(e: MouseEvent) {
  const t = e.target as Node;
  if (popover && !popover.contains(t) && !triggerRef.value?.contains(t)) {
    closePopover();
  }
}

function position() {
  if (!popover || !triggerRef.value) return;
  const r = triggerRef.value.getBoundingClientRect();
  const pw = popover.offsetWidth;
  const ph = popover.offsetHeight;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const gap = 4;
  let top = r.bottom + gap;
  if (top + ph > vh - 8 && r.top - ph - gap >= 8) top = r.top - ph - gap;
  let left = r.right - pw;
  if (left < 8) left = 8;
  if (left + pw > vw - 8) left = vw - pw - 8;
  const triggerCx = r.left + r.width / 2 - left;
  const triggerTop = r.top - top;
  popover.style.left = `${left}px`;
  popover.style.top = `${top}px`;
  popover.style.setProperty('--dr-origin-x', `${triggerCx}px`);
  popover.style.setProperty('--dr-origin-y', `${triggerTop}px`);
}

function onResize() {
  if (!triggerRef.value?.isConnected) { closePopover(); return; }
  if (popover) position();
}

function render() {
  if (!popover) return;
  popover.innerHTML = '';

  const year = viewDate.value.getFullYear();
  const month = viewDate.value.getMonth();

  // Header
  const header = document.createElement('div');
  header.className = 'dr-header';

  const title = document.createElement('span');
  title.className = 'dr-title';
  title.textContent = '日期范围';

  const nav = document.createElement('div');
  nav.className = 'dr-nav';

  const prevBtn = document.createElement('button');
  prevBtn.className = 'dr-nav-btn';
  prevBtn.type = 'button';
  prevBtn.setAttribute('aria-label', '上一月');
  prevBtn.innerHTML = ''; // icon set below
  nav.appendChild(prevBtn);

  const label = document.createElement('span');
  label.className = 'dr-nav-label';
  label.textContent = `${year}年  ${MONTHS[month]}`;
  nav.appendChild(label);

  const nextBtn = document.createElement('button');
  nextBtn.className = 'dr-nav-btn';
  nextBtn.type = 'button';
  nextBtn.setAttribute('aria-label', '下一月');
  nav.appendChild(nextBtn);

  header.appendChild(title);
  header.appendChild(nav);
  popover.appendChild(header);

  prevBtn.addEventListener('click', () => {
    const d = new Date(viewDate.value);
    d.setMonth(d.getMonth() - 1);
    viewDate.value = d;
    render();
  });
  nextBtn.addEventListener('click', () => {
    const d = new Date(viewDate.value);
    d.setMonth(d.getMonth() + 1);
    viewDate.value = d;
    render();
  });
  prevBtn.appendChild(createIcon(ChevronLeft, 14));
  nextBtn.appendChild(createIcon(ChevronRight, 14));

  // Weekday row
  const wdRow = document.createElement('div');
  wdRow.className = 'dr-weekdays';
  for (const w of WEEKDAYS) {
    const el = document.createElement('span');
    el.className = 'dr-weekday';
    el.textContent = w;
    wdRow.appendChild(el);
  }
  popover.appendChild(wdRow);

  // Month grid
  const grid = document.createElement('div');
  grid.className = 'dr-grid';
  const weeks = monthGrid(year, month);
  for (const week of weeks) {
    for (const day of week) {
      const cell = document.createElement('button');
      cell.className = 'dr-day';
      cell.type = 'button';
      cell.dataset.time = String(day.getTime());

      const num = document.createElement('span');
      num.className = 'dr-day-num';
      num.textContent = String(day.getDate());
      cell.appendChild(num);

      if (day.getMonth() !== month) cell.classList.add('is-other');
      if (isSameDay(day, new Date())) cell.classList.add('is-today');

      if (draftRange.start && draftRange.end) {
        if (isSameDay(day, draftRange.start)) cell.classList.add('is-range-start');
        else if (isSameDay(day, draftRange.end)) cell.classList.add('is-range-end');
        else if (inRange(day, draftRange.start, draftRange.end)) cell.classList.add('is-in-range');
      } else if (draftRange.start && !draftRange.end) {
        if (isSameDay(day, draftRange.start)) cell.classList.add('is-range-start');
      }

      cell.addEventListener('click', (e) => {
        e.stopPropagation();
        const d = startOfDay(day);
        if (!draftRange.start || (draftRange.start && draftRange.end)) {
          draftRange = { start: d, end: null };
          render();
        } else {
          if (d < draftRange.start) {
            draftRange = { start: d, end: draftRange.start };
          } else {
            draftRange = { start: draftRange.start, end: d };
          }
          render();
        }
      });

      grid.appendChild(cell);
    }
  }
  popover.appendChild(grid);

  // Footer
  const footer = document.createElement('div');
  footer.className = 'dr-footer';

  if (draftRange.start || draftRange.end) {
    const reset = document.createElement('button');
    reset.className = 'dr-footer-btn';
    reset.type = 'button';
    reset.textContent = '清除';
    reset.addEventListener('click', () => {
      draftRange = { start: null, end: null };
      render();
    });
    footer.appendChild(reset);
  }

  const hint = document.createElement('span');
  hint.className = 'dr-hint';
  hint.textContent = draftRange.start && !draftRange.end ? '再点一次选结束日期' : '';
  footer.appendChild(hint);

  const closeBtn = document.createElement('button');
  closeBtn.className = 'dr-footer-btn dr-footer-close';
  closeBtn.type = 'button';
  closeBtn.textContent = '完成';
  closeBtn.addEventListener('click', applyDraft);
  footer.appendChild(closeBtn);

  popover.appendChild(footer);
}

function createIcon(iconFn: (props: any) => any, size: number): SVGSVGElement {
  const wrapper = document.createElement('span');
  // We can't easily call lucide render functions in the DOM directly,
  // so just use text arrows
  if (iconFn === ChevronLeft) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>`;
    wrapper.innerHTML = svg;
    return wrapper.firstElementChild as SVGSVGElement;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>`;
  wrapper.innerHTML = svg;
  return wrapper.firstElementChild as SVGSVGElement;
}

onUnmounted(() => {
  closePopover();
});
</script>

<style scoped></style>
