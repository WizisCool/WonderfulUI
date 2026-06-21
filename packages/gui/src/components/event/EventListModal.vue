<template>
  <div v-if="visible" class="event-list-modal-backdrop" @click="close">
    <div class="event-list-modal" role="dialog" aria-label="本局事件" @click.stop>
      <button class="ctrl-btn event-list-modal-close" aria-label="关闭" @click.stop="close">
        <X :size="16" />
      </button>
      <div class="event-list-modal-header">
        <div class="event-list-modal-title">本局事件</div>
        <div class="event-list-modal-sub">
          <span>{{ matchLabel }}</span>
          <template v-if="kills !== undefined && deaths !== undefined">
            <span class="event-list-meta-sep">·</span>
            <span class="event-list-meta-kill">击杀 {{ kills }}</span>
            <span class="event-list-meta-sep">·</span>
            <span class="event-list-meta-death">阵亡 {{ deaths }}</span>
          </template>
        </div>
      </div>
      <div class="event-list-scroll">
        <div class="event-list-row event-list-row-head">
          <span class="event-list-col-time">时间</span>
          <span class="event-list-col-type" />
          <span class="event-list-col-player">玩家</span>
          <span class="event-list-col-weapon">武器</span>
          <span class="event-list-col-extra" />
        </div>
        <EventRow
          v-for="ev in events"
          :key="`${ev.timeMs}-${ev.type}-${ev.playerName}`"
          :event="ev"
          @play="onPlayEvent"
        />
      </div>
      <div class="event-list-modal-footer">
        <Play :size="12" />
        <span>点击行跳播 · 列表留在背后，关闭播放器后可继续查看</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { X, Play } from 'lucide-vue-next';
import EventRow from './EventRow.vue';
import type { NormalizedMatchEvent } from '../../utils/match-events.ts';
import type { VideoItem } from '@wonderful-ui/parser';

const props = defineProps<{
  events: NormalizedMatchEvent[];
  matchLabel: string;
  kills?: number;
  deaths?: number;
}>();

const emit = defineEmits<{
  close: [];
  play: [video: VideoItem, seekMs: number];
}>();

const visible = ref(true);

function close() {
  visible.value = false;
  emit('close');
}

function onPlayEvent(video: VideoItem, seekMs: number) {
  emit('play', video, seekMs);
}

// Escape key
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault();
    close();
  }
}

onMounted(() => {
  document.addEventListener('keydown', onKeydown, true);
});

onUnmounted(() => {
  document.removeEventListener('keydown', onKeydown, true);
});
</script>

<style scoped>
.event-list-modal-backdrop {
  position: fixed; inset: 0;
  z-index: 1100;
  display: flex; align-items: center; justify-content: center;
  background: oklch(0 0 0 / 0.7);
}
.event-list-modal {
  position: relative;
  width: min(640px, 92vw);
  max-height: 80vh;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  display: flex; flex-direction: column;
  overflow: hidden;
}
.event-list-modal-close {
  position: absolute; top: 10px; right: 10px;
  width: 28px; height: 28px;
  z-index: 2;
}
.event-list-modal-header {
  padding: 14px 20px 12px;
  border-bottom: 1px solid var(--border-soft);
  background: var(--surface-2);
}
.event-list-modal-title {
  font-size: 14px;
  font-weight: var(--w-semibold);
  color: var(--ink);
  margin-bottom: 4px;
}
.event-list-modal-sub {
  display: flex; align-items: center;
  font-size: 12px;
  color: var(--ink-3);
  gap: 6px;
  flex-wrap: wrap;
}
.event-list-meta-kill  { color: var(--win);  font-family: var(--font-mono); }
.event-list-meta-death { color: var(--loss); font-family: var(--font-mono); }
.event-list-meta-sep   { color: var(--ink-4); }

.event-list-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0 8px;
}

.event-list-row-head {
  display: grid;
  grid-template-columns: 56px 76px 1fr 130px 80px;
  align-items: center;
  gap: 12px;
  font-size: 11px;
  color: var(--ink-3);
  background: var(--surface);
  cursor: default;
  border-bottom: 1px solid var(--border);
  padding: 6px 16px;
  font-weight: var(--w-medium);
  letter-spacing: 0.04em;
}
.event-list-row-head:hover { background: var(--surface); }
.event-list-row-head::before { display: none; }

.event-list-modal-footer {
  display: flex; align-items: center; gap: 6px;
  padding: 10px 20px;
  font-size: 11px;
  color: var(--ink-3);
  background: var(--surface);
  border-top: 1px solid var(--border-soft);
}
</style>
