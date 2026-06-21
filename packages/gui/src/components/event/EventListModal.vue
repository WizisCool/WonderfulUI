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

<style scoped></style>
