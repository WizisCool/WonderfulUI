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
      <Crosshair v-if="event.type === 'kill'" :size="11" />
      <Skull v-else :size="11" />
      <span>{{ event.type === 'kill' ? '击杀' : '阵亡' }}</span>
    </span>
    <span class="event-list-col-player">{{ event.playerName || '—' }}</span>
    <span class="event-list-col-weapon">{{ weaponLabel || '—' }}</span>
    <span class="event-list-col-extra">{{ extras }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { Crosshair, Skull } from 'lucide-vue-next';
import { weaponNameOnly } from '../../weapons.ts';
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

<style scoped></style>
