<template>
  <div
    class="event-list-row"
    :class="[`type-${event.type}`, { headshot: event.isHeadshot }]"
    :data-time-ms="String(event.timeMs)"
    role="button"
    tabindex="0"
    @click="openPlay"
    @keydown.enter.prevent="openPlay"
    @keydown.space.prevent="openPlay"
  >
    <span class="event-list-col-time">{{ fmtMs(event.timeMs) }}</span>
    <span class="event-list-col-type" :class="`event-list-type-${event.type}`">
      <WIcon v-if="event.type === 'kill'" icon="ph:crosshair" :size="11" />
      <WIcon v-else icon="ph:skull" :size="11" />
      <span>{{ event.type === 'kill' ? '击杀' : '阵亡' }}</span>
    </span>
    <span class="event-list-col-player">{{ event.playerName || '—' }}</span>
    <span class="event-list-col-weapon">{{ weaponLabel || '—' }}</span>
    <span class="event-list-col-extra">{{ extras }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import WIcon from '../common/WIcon.vue';
import { weaponNameOnly } from '../../utils/weapons.ts';
import type { NormalizedMatchEvent } from '../../utils/match-events.ts';
import type { VideoItem } from '@wonderful-ui/parser';

const props = defineProps<{
  event: NormalizedMatchEvent;
}>();

const emit = defineEmits<{
  play: [video: VideoItem, seekMs: number];
}>();

const weaponLabel = computed(() =>
  weaponNameOnly(
    String((props.event.rawEvent.event_ext as Record<string, unknown> | undefined)?.WeaponSkinName ?? ''),
  )
);

const extras = computed(() => {
  const parts: string[] = [];
  if (props.event.isHeadshot) parts.push('爆头');
  if (props.event.assistNum > 0) parts.push(`助攻×${props.event.assistNum}`);
  return parts.join(' · ') || '';
});

function fmtMs(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

function openPlay() {
  emit('play', props.event.video, props.event.playbackSeekMs);
}
</script>

<style scoped>
.event-list-row {
  display: grid;
  grid-template-columns: 56px 76px 1fr 130px 80px;
  align-items: center;
  gap: 12px;
  padding: 8px 16px;
  font-size: 12px;
  cursor: pointer;
  border-bottom: 1px solid var(--border-soft);
  color: var(--ink);
  position: relative;
  transition: background 80ms ease-out;
}
.event-list-row:hover { background: var(--surface-3); }
.event-list-row:focus-visible { outline: 1px solid var(--accent); outline-offset: -1px; }

.event-list-col-time {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--ink-2);
}
.event-list-col-type {
  display: inline-flex; align-items: center; gap: 4px;
  font-size: 12px;
  font-weight: var(--w-medium);
  color: var(--ink-2);
}
.event-list-col-type.event-list-type-kill  { color: var(--win); }
.event-list-col-type.event-list-type-death { color: var(--loss); }
.event-list-col-player {
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  color: var(--ink);
}
.event-list-col-weapon {
  color: var(--ink-3);
  font-size: 11px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.event-list-col-extra {
  color: var(--ink-3);
  font-size: 11px;
  text-align: right;
  white-space: nowrap;
}
.event-list-row.headshot .event-list-col-extra {
  color: var(--ink-2);
}
</style>
