<template>
  <div
    class="match-row"
    :class="{ 'is-selected': isSelected }"
    :data-match-id="match.matches_id"
    :data-tip="tooltipText"
    @click="$emit('click')"
    @dblclick="$emit('dblclick')"
  >
    <div class="match-cover" aria-hidden="true">
      <img
        v-if="mapSrc"
        class="cover-bg"
        :src="mapSrc"
        alt=""
        loading="lazy"
        decoding="async"
        fetchpriority="low"
        @error="onMapBgError"
      />
      <div v-else class="cover-bg-fallback">{{ agentInitial }}</div>
      <img
        v-if="heroSrc"
        class="hero-img"
        :src="heroSrc"
        :alt="agentName"
        loading="lazy"
        decoding="async"
        @error="onHeroError"
      />
      <div v-else class="hero-placeholder" :style="{ '--hue': heroHue }">{{ agentInitial }}</div>
      <div v-if="badge" :class="'cover-badge cover-badge-' + badge.type" :aria-label="badge.ariaLabel" :title="badge.title">
        <component :is="badge.icon" :size="9" />
        {{ badge.type.toUpperCase() }}
      </div>
    </div>
    <div class="match-meta">
      <div class="match-line match-line-1">
        <span class="match-agent">{{ agentName }}</span>
        <span
          class="match-result-pill"
          :class="resultClass"
          :aria-label="resultAriaLabel"
        >{{ resultText }} {{ matchScore }}</span>
      </div>
      <div class="match-line match-line-2">
        <span class="match-map">{{ mapName }}</span>
        <span v-if="modeText" class="match-mode">
          <img
            v-if="modeIconSrc"
            class="mode-icon mode-icon-sm"
            :src="modeIconSrc"
            alt=""
            loading="lazy"
            decoding="async"
            @error="onModeIconError"
          />
          {{ modeText }}
        </span>
      </div>
      <div class="match-line match-line-3">
        <span class="match-kda">{{ kdaText }}</span>
        <span class="match-video-chip">
          <Video :size="10" />
          × {{ match.videos.length }}
        </span>
      </div>
      <div class="match-footer">
        <span class="match-time">{{ timeText }}</span>
        <span class="match-sep-dot">·</span>
        <span class="match-account">{{ accountLabel }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { Video, Crown, Medal } from 'lucide-vue-next';
import { convertFileSrc } from '../../tauri-adapter.ts';
import { useAccountStore } from '../../stores/account.ts';
import { agentCn, mapCn, modeCn, fmtScore } from '../../utils/filters.ts';
import type { MatchRecord } from '@wonderful-ui/parser';

const props = defineProps<{
  match: MatchRecord;
  isSelected: boolean;
  accountLabel: string;
}>();

defineEmits<{
  click: [];
  dblclick: [];
}>();

const account = useAccountStore();

const mapBgFailed = ref(false);
const heroFailed = ref(false);
const modeIconFailed = ref(false);

const agentName = computed(() => agentCn(props.match));
const agentInitial = computed(() => agentName.value[0]?.toUpperCase() ?? '?');
const mapName = computed(() => mapCn(props.match));
const modeText = computed(() => modeCn(props.match));
const matchScore = computed(() => fmtScore(props.match));
const resultText = computed(() => props.match.stats.has_won ? '胜' : '败');
const resultClass = computed(() => props.match.stats.has_won ? 'result-win' : 'result-loss');
const resultAriaLabel = computed(() =>
  props.match.stats.has_won ? `胜利 ${matchScore.value}` : `失败 ${matchScore.value}`
);
const kdaText = computed(() =>
  `${props.match.stats.kills}/${props.match.stats.deaths}/${props.match.stats.assists}`
);

const timeText = computed(() => {
  const d = new Date(props.match.matches_time);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}  ${pad(d.getHours())}:${pad(d.getMinutes())}`;
});

const heroHue = computed(() => {
  let hue = 0;
  for (const c of agentName.value) hue = (hue * 31 + c.charCodeAt(0)) % 360;
  return String(hue);
});

const mapSrc = computed(() => {
  if (mapBgFailed.value) return null;
  const url = props.match.career?.map_image as string | undefined;
  if (!url) return null;
  const local = account.assetPathCache.get(url);
  return local ? convertFileSrc(local) : url;
});

const heroSrc = computed(() => {
  if (heroFailed.value) return null;
  const url = props.match.career?.hero_image as string | undefined;
  if (!url) return null;
  const local = account.assetPathCache.get(url);
  return local ? convertFileSrc(local) : null;
});

const modeIconSrc = computed(() => {
  if (modeIconFailed.value) return null;
  const url = props.match.career?.game_mode_icon;
  if (typeof url !== 'string' || !url) return null;
  const local = account.assetPathCache.get(url);
  return local ? convertFileSrc(local) : url;
});

const badge = computed(() => {
  const achv = account.matchAchievements.get(props.match.matches_id);
  if (!achv) return null;
  const isMvp = achv.type === 'mvp';
  return {
    type: achv.type,
    ariaLabel: isMvp ? '本局获得 MVP' : '本局获得 SVP',
    title: achv.typeStr,
    icon: isMvp ? Crown : Medal,
  };
});

const tooltipText = computed(() =>
  `${agentName.value}  ·  ${matchScore.value}  ·  ${mapName.value}\n${props.accountLabel}\n${timeText.value}\n${props.match.matches_id}`
);

function onMapBgError() { mapBgFailed.value = true; }
function onHeroError() { heroFailed.value = true; }
function onModeIconError() { modeIconFailed.value = true; }
</script>

<style scoped>
.match-row {
  display: grid;
  grid-template-columns: 88px 1fr;
  gap: 12px;
  align-items: center;
  min-height: var(--row-h);
  padding: 8px;
  background: var(--surface);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius);
  cursor: pointer;
  transition:
    background 120ms ease-out,
    border-color 120ms ease-out,
    transform 160ms cubic-bezier(0.16, 1, 0.3, 1);
}
.match-row:hover {
  background: var(--surface-2);
  border-color: var(--ink-4);
}
.match-row.is-selected {
  background: var(--surface-2);
  border-color: var(--accent);
}
.match-cover {
  width: 88px; height: 72px;
  background: var(--bg);
  border-radius: 4px;
  position: relative;
  overflow: hidden;
  box-shadow:
    0 1px 2px oklch(0.10 0.01 30 / 0.45),
    0 4px 12px oklch(0.10 0.01 30 / 0.25),
    inset 0 1px 0 oklch(1 0 0 / 0.04);
}
.cover-placeholder {
  font-size: 28px; font-weight: var(--w-bold); color: var(--ink-3);
}
.cover-placeholder-lg { font-size: 80px; }
.cover-img {
  width: 100%; height: 100%; object-fit: cover;
  display: block;
  border-radius: 4px;
}
.cover-bg {
  position: absolute; inset: 0;
  width: 100%; height: 100%;
  object-fit: cover;
  transform: scale(1.05);
  z-index: 0;
}
.cover-bg-fallback {
  position: absolute; inset: 0;
  background: var(--bg);
  display: flex; align-items: center; justify-content: center;
  font-size: 22px; font-weight: var(--w-bold); color: var(--ink-3);
  z-index: 0;
}

.match-cover::after {
  content: '';
  position: absolute;
  inset: 0;
  background: radial-gradient(ellipse at bottom right, rgba(0, 0, 0, 0.48) 0%, rgba(0, 0, 0, 0.23) 30%, rgba(0, 0, 0, 0.08) 60%, rgba(0, 0, 0, 0.04) 100%);
  pointer-events: none;
  z-index: 1;
}

.match-cover .hero-img,
.match-cover .hero-placeholder {
  position: absolute;
  width: 36px; height: 36px;
  border-radius: 50%;
  bottom: 3px; right: 3px;
  z-index: 2;
  font-size: 15px;
  box-shadow:
    inset 0 0 0 1px oklch(1 0 0 / 0.1),
    0 1px 1px oklch(0.08 0.01 30 / 0.5),
    0 2px 4px oklch(0.08 0.01 30 / 0.3),
    0 8px 16px oklch(0.08 0.01 30 / 0.18);
  object-fit: cover;
}

.cover-badge {
  position: absolute;
  top: 4px; left: 4px;
  z-index: 3;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px 6px;
  border-radius: 8px;
  font-size: 9px;
  font-weight: var(--w-semibold);
  font-family: var(--font-sans);
  line-height: 1;
  letter-spacing: 0.3px;
  pointer-events: none;
  box-shadow: 0 1px 2px oklch(0.10 0.01 30 / 0.4);
  border: 1px solid oklch(0 0 0 / 0.25);
}
.cover-badge-mvp {
  background: oklch(0.86 0.14 90);
  color: oklch(0.22 0.06 60);
  text-shadow: 0 1px 0 oklch(1 0 0 / 0.2);
}
.cover-badge-svp {
  background: oklch(0.65 0.24 305);
  color: oklch(0.99 0.01 300);
  text-shadow: 0 1px 0 oklch(0.10 0 0 / 0.35);
}

.match-meta { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.match-line {
  display: flex; align-items: center; justify-content: space-between;
  gap: 8px;
}
.match-line-1 { font-size: 13px; }
.match-line-2 { font-size: 12px; color: var(--ink-3); }
.match-line-3 { font-size: 12px; color: var(--ink-2); }
.match-footer {
  display: flex; align-items: center; gap: 5px;
  margin-top: 2px;
  font-size: 11px;
  color: var(--ink-3);
  min-width: 0;
}
.match-sep-dot { color: var(--ink-4); font-family: var(--font-mono); font-size: 11px; }
.match-account {
  color: var(--ink-3);
  font-family: var(--font-sans);
  font-size: 11px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.match-time    { font-family: var(--font-mono); color: var(--ink-3); font-size: 12px; flex-shrink: 0; }
.match-result  {
  font-weight: 700; font-family: var(--font-mono); font-size: 12px;
  width: 18px; text-align: center;
  padding: 1px 4px; border-radius: 3px;
}
.match-result.result-win  { color: var(--win); background: var(--win-soft); }
.match-result.result-loss { color: var(--loss); background: var(--loss-soft); }
.match-result-pill {
  font-weight: 700; font-family: var(--font-sans); font-size: 11px;
  padding: 1px 7px; border-radius: 3px;
  letter-spacing: 0.02em;
  flex-shrink: 0;
}
.match-result-pill.result-win  { color: var(--win);  background: var(--win-soft); }
.match-result-pill.result-loss { color: var(--loss); background: var(--loss-soft); }
.match-agent { color: var(--ink); font-weight: var(--w-medium); }
.match-map   { color: var(--ink-2); font-family: var(--font-sans); font-size: 12px; }
.match-sep   { color: var(--ink-4); font-family: var(--font-mono); font-size: 12px; }
.match-kda   { color: var(--ink-2); font-family: var(--font-mono); font-size: 12px; font-weight: var(--w-medium); }
.match-mode  {
  display: inline-flex; align-items: center; gap: 4px;
  font-size: 10px;
  color: var(--ink-3);
  background: var(--surface-2);
  border: 1px solid var(--border-soft);
  border-radius: 999px;
  padding: 1px 7px;
  font-family: var(--font-sans);
  letter-spacing: 0.02em;
}
.mode-icon {
  display: inline-block;
  object-fit: contain;
  flex-shrink: 0;
}
.mode-icon-sm { width: 12px; height: 12px; }
.mode-icon-md { width: 16px; height: 16px; vertical-align: -3px; }
.match-video-chip {
  display: inline-flex; align-items: center; gap: 3px;
  font-size: 10px;
  color: var(--ink-3);
  background: var(--surface-2);
  border: 1px solid var(--border-soft);
  border-radius: 999px;
  padding: 1px 7px;
  font-family: var(--font-sans);
  letter-spacing: 0.02em;
  flex-shrink: 0;
}
</style>
