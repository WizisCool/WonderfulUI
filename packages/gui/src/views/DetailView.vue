<template>
  <aside class="pane detail detail-scroll" aria-label="高光详情">
    <template v-if="match">
      <!-- header: hero + (agent | W 13:10 pill) + (mode·map·duration) -->
      <div class="detail-header">
        <div class="hero-avatar">
          <img
            v-if="heroSrc"
            class="hero-img"
            :src="heroSrc"
            :alt="agentName"
            loading="lazy"
            decoding="async"
            @error="heroFailed = true"
          />
          <div v-else class="hero-placeholder" :style="{ '--hue': heroHue }">{{ agentInitial }}</div>
        </div>
        <div class="detail-header-meta">
          <div class="detail-agent-row">
            <div class="detail-agent">{{ agentName }}</div>
            <span
              class="match-result-pill is-detail"
              :class="resultClass"
              :aria-label="resultAriaLabel"
            >{{ resultText }} {{ matchScore }}</span>
          </div>
          <div class="detail-sub">
            <img
              v-if="modeIconSrc"
              class="mode-icon mode-icon-md"
              :src="modeIconSrc"
              alt=""
              loading="lazy"
              decoding="async"
              @error="modeIconFailed = true"
            />
            {{ detailSubText }}
          </div>
        </div>
      </div>

      <!-- stats: 3x2 card grid -->
      <div class="detail-stats-row">
        <div class="stat-cell is-win">
          <div class="stat-icon"><WIcon icon="ph:crosshair" :size="14" /></div>
          <div class="stat-value">{{ match.stats.kills }}</div>
          <div class="stat-label">击杀</div>
        </div>
        <div class="stat-cell is-loss">
          <div class="stat-icon"><WIcon icon="ph:skull" :size="14" /></div>
          <div class="stat-value">{{ match.stats.deaths }}</div>
          <div class="stat-label">死亡</div>
        </div>
        <div class="stat-cell is-assist">
          <div class="stat-icon"><WIcon icon="ph:hand-heart" :size="14" /></div>
          <div class="stat-value">{{ match.stats.assists }}</div>
          <div class="stat-label">助攻</div>
        </div>
        <div class="stat-row2">
          <div class="stat-cell" :class="kdaToneClass">
            <div class="stat-icon"><WIcon icon="ph:trend-up" :size="14" /></div>
            <div class="stat-value">{{ kdaRatioText }}</div>
            <div class="stat-label">KDA</div>
          </div>
          <div class="stat-cell">
            <div class="stat-icon"><WIcon icon="ph:star" :size="14" /></div>
            <div class="stat-value">{{ match.stats.score }}</div>
            <div class="stat-label">得分</div>
          </div>
          <button
            class="stat-cell event-stat-cell"
            type="button"
            aria-label="打开本局事件列表"
            :disabled="eventBtnDisabled"
            :title="eventBtnDisabled ? (detail.roundsLoaded && eventCount === 0 ? '这场高光未携带事件数据' : '') : undefined"
            @click="openEventList()"
          >
            <template v-if="!detail.roundsLoaded">
              <div class="event-stat-spinner"><WIcon icon="ph:circle-notch" :size="14" class="spin" /></div>
              <div class="stat-value">—</div>
              <div class="stat-label">加载中…</div>
            </template>
            <template v-else>
              <div class="stat-icon"><WIcon icon="ph:lightning" :size="14" /></div>
              <div class="stat-value">{{ eventCount }}</div>
              <div class="stat-label">事件</div>
            </template>
          </button>
        </div>
      </div>

      <!-- 集锦 section -->
      <section v-if="montages.length > 0" class="detail-section">
        <div class="section-title">集锦</div>
        <div class="montage-grid">
          <div v-for="v in montages" :key="v.video_id" class="montage-card">
            <div class="montage-cover">
              <img
                v-if="v.video_poster && !videoPosterFailed(v.video_id)"
                class="cover-img"
                :src="fileUrl(v.video_poster)"
                :alt="videoInitialText(v)"
                loading="lazy"
                decoding="async"
                @error="onVideoPosterError(v.video_id)"
              />
              <span v-else class="cover-placeholder">{{ videoInitialText(v) }}</span>
              <span v-if="qualityBadge(v)" class="resolution-chip">{{ qualityBadge(v) }}</span>
            </div>
            <div class="montage-info">
              <div class="montage-title">{{ v.video_name }}</div>
              <div class="montage-meta">{{ fmtVideoMeta(v) }}</div>
            </div>
            <button
              class="btn btn-play"
              :aria-label="'播放 ' + v.video_name"
              @click="playVideo(v)"
            >
              <WIcon icon="ph:play" :size="14" />
            </button>
          </div>
        </div>
      </section>

      <!-- 高光时刻 section: filter chips + grid -->
      <section v-if="moments.length > 0" class="detail-section">
        <div class="section-title">高光时刻</div>
        <div class="moment-chips">
          <button
            v-for="type in momentTypeOrder"
            :key="type"
            class="moment-chip"
            :class="{ 'is-active': detail.momentFilter === type }"
            type="button"
            :data-type="type"
            @click="detail.setMomentFilter(type)"
          >{{ type }} × {{ momentsByType.get(type)!.length }}</button>
        </div>
        <div class="moment-grid">
          <template v-if="visibleMoments.length > 0">
            <div v-for="v in visibleMoments" :key="v.video_id" class="moment-card">
              <div class="moment-cover">
                <img
                  v-if="v.video_poster && !videoPosterFailed(v.video_id)"
                  class="cover-img"
                  :src="fileUrl(v.video_poster)"
                  :alt="videoInitialText(v)"
                  loading="lazy"
                  decoding="async"
                  @error="onVideoPosterError(v.video_id)"
                />
                <span v-else class="cover-placeholder">{{ videoInitialText(v) }}</span>
                <span v-if="qualityBadge(v)" class="resolution-chip">{{ qualityBadge(v) }}</span>
              </div>
              <div class="moment-info">
                <div class="moment-name">{{ v.video_name }}</div>
                <div class="moment-duration">{{ fmtVideoMeta(v) }}</div>
              </div>
              <button
                class="btn btn-play"
                :aria-label="'播放 ' + v.video_name"
                @click="playVideo(v)"
              >
                <WIcon icon="ph:play" :size="14" />
              </button>
            </div>
          </template>
          <div v-else class="empty-inline">这场没有「{{ detail.momentFilter }}」</div>
        </div>
      </section>

      <div v-if="montages.length === 0 && moments.length === 0" class="empty">
        <div class="empty-title">这场高光没有视频</div>
      </div>
    </template>

    <div v-else class="empty">
      <div class="empty-title">没有选中</div>
    </div>
    <EventListModal
      v-if="eventListVisible && match"
      :events="eventListEvents"
      :match-label="eventListLabel"
      :kills="match.stats.kills"
      :deaths="match.stats.deaths"
      @close="onEventListClose"
      @play="onEventListPlay"
    />
  </aside>
</template>

<script setup lang="ts">
import { computed, ref, watch, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import WIcon from '../components/common/WIcon.vue';
import { convertFileSrc } from '../tauri-adapter.ts';
import { useAccountStore } from '../stores/account.ts';
import { useDetailStore } from '../stores/detail.ts';
import { usePlayerStore } from '../stores/player.ts';
import { agentCn, mapCn, modeCn, fmtScore, kdaRatio, fmtMatchDuration } from '../utils/filters.ts';
import { resolveMatchAssetSrc } from '../utils/valorant-assets.ts';
import { normalizeMatchEvents, type NormalizedMatchEvent } from '../utils/match-events.ts';
import type { MatchRecord, VideoItem } from '@wonderful-ui/parser';
import EventListModal from '../components/event/EventListModal.vue';

const account = useAccountStore();
const detail = useDetailStore();
const player = usePlayerStore();

const route = useRoute();

const heroFailed = ref(false);
const modeIconFailed = ref(false);
const videoPosterErrors = ref(new Set<string>());

const MONTAGE_TYPES = new Set(['击杀集锦', '死亡集锦']);
const MOMENT_TYPE_ORDER_REF = ['三杀时刻', '四杀时刻', '五杀时刻', '进阶剪辑'];

const match = computed(() => detail.selectedMatch);
const agentName = computed(() => match.value ? agentCn(match.value) : '');
const agentInitial = computed(() => agentName.value[0]?.toUpperCase() ?? '?');
const matchScore = computed(() => match.value ? fmtScore(match.value) : '');
const resultText = computed(() => match.value?.stats.has_won ? '胜' : '败');
const resultClass = computed(() => match.value?.stats.has_won ? 'result-win' : 'result-loss');
const resultAriaLabel = computed(() =>
  match.value ? (match.value.stats.has_won ? `胜利 ${matchScore.value}` : `失败 ${matchScore.value}`) : ''
);
const detailSubText = computed(() => {
  if (!match.value) return '';
  const mode = modeCn(match.value);
  const map = mapCn(match.value);
  const dur = fmtMatchDuration(match.value);
  return [mode ? `${mode} · ${map}` : map, dur].filter(Boolean).join(' · ');
});

const kdaRatioText = computed(() => match.value ? kdaRatio(match.value) : '0.00');
const kdaToneClass = computed(() => {
  if (!match.value) return '';
  const v = (match.value.stats.kills + match.value.stats.assists) / Math.max(match.value.stats.deaths, 1);
  if (v >= 1.5) return 'is-win';
  if (v <= 0.8) return 'is-loss';
  return '';
});

const eventCount = computed(() => match.value ? normalizeMatchEvents(match.value).length : 0);

const eventListVisible = ref(false);
const eventListEvents = ref<NormalizedMatchEvent[]>([]);
const eventListLabel = ref('');

const eventBtnDisabled = computed(() => {
  if (!match.value) return true;
  if (!detail.roundsLoaded) return true;
  return eventCount.value === 0;
});

const heroHue = computed(() => {
  let hue = 0;
  for (const c of agentName.value) hue = (hue * 31 + c.charCodeAt(0)) % 360;
  return String(hue);
});

const heroSrc = computed(() =>
  match.value
    ? resolveMatchAssetSrc(match.value, 'hero_image', account.assetPathCache, convertFileSrc, heroFailed.value)
    : null,
);

const modeIconSrc = computed(() =>
  match.value
    ? resolveMatchAssetSrc(match.value, 'game_mode_icon', account.assetPathCache, convertFileSrc, modeIconFailed.value)
    : null,
);

const montages = computed(() =>
  match.value ? match.value.videos.filter(v => MONTAGE_TYPES.has(v.video_type)) : []
);
const moments = computed(() =>
  match.value ? match.value.videos.filter(v => !MONTAGE_TYPES.has(v.video_type)) : []
);
const momentsByType = computed(() => {
  const map = new Map<string, VideoItem[]>();
  for (const v of moments.value) {
    if (!map.has(v.video_type)) map.set(v.video_type, []);
    map.get(v.video_type)!.push(v);
  }
  return map;
});
const momentTypeOrder = computed(() => {
  const existing = momentsByType.value;
  const ordered = MOMENT_TYPE_ORDER_REF.filter(t => existing.has(t));
  for (const t of existing.keys()) {
    if (!MOMENT_TYPE_ORDER_REF.includes(t)) ordered.push(t);
  }
  return ordered;
});
const visibleMoments = computed(() => {
  if (!detail.momentFilter) return moments.value;
  return momentsByType.value.get(detail.momentFilter) ?? [];
});

function fileUrl(p: string): string { return convertFileSrc(p); }

function fmtDuration(ms: number): string {
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function fmtResolution(v: VideoItem): string {
  if (v.video_level === '1') return '720p';
  if (v.video_level === '3') return '1080p';
  const raw = v.video_resolution.replace(/\r/g, '').trim();
  const m = /^(\d+)\s*x\s*(\d+)$/.exec(raw);
  if (m) return `${m[1]}×${m[2]}`;
  return raw || '—';
}

function qualityBadge(v: VideoItem): string {
  const res = fmtResolution(v);
  const fps = v.video_fps;
  if (res && fps) return `${res} · ${fps}`;
  if (res) return res;
  if (fps) return `${fps}fps`;
  return '';
}

function fmtVideoMeta(v: VideoItem): string {
  const parts: string[] = [fmtDuration(v.video_duration)];
  if (v.video_size) parts.push(fmtSize(v.video_size));
  return parts.join(' · ');
}

function videoInitialText(v: VideoItem): string { return v.video_name[0] ?? '?'; }
function videoPosterFailed(id: string): boolean { return videoPosterErrors.value.has(id); }
function onVideoPosterError(id: string) { videoPosterErrors.value.add(id); }

function playVideo(v: VideoItem) {
  if (!match.value) return;
  player.open(v, match.value);
}

function openEventList() {
  if (!match.value || !detail.roundsLoaded) return;
  const events = normalizeMatchEvents(match.value);
  if (events.length === 0) return;
  eventListEvents.value = events;
  eventListLabel.value = `${agentName.value} · ${mapCn(match.value)}`;
  eventListVisible.value = true;
}

function onEventListClose() {
  eventListVisible.value = false;
}

function onEventListPlay(video: VideoItem, seekMs: number) {
  if (!match.value) return;
  player.open(video, match.value, seekMs);
}

watch(() => route.params.id, (id) => {
  if (id && typeof id === 'string') {
    const m = account.matches.find(m => m.matches_id === id);
    if (m && m.matches_id !== detail.selectedMatch?.matches_id) {
      detail.selectMatch(m);
    }
  }
}, { immediate: true });

watch(() => detail.selectedMatch, (m) => {
  if (m && m.videos.length > 0 && !detail.roundsLoaded) {
    detail.fetchRounds();
  }
}, { immediate: true });
</script>

<style scoped>
.pane.detail.detail-scroll {
  overflow-y: auto;
  overflow-x: hidden;
}

.detail-header {
  display: flex;
  gap: 12px;
  align-items: center;
  padding: 12px var(--pad);
  border-bottom: 1px solid var(--border-soft);
}
.hero-avatar {
  width: 52px; height: 52px;
  border-radius: 8px;
  overflow: hidden;
  flex-shrink: 0;
}
.hero-img {
  width: 100%; height: 100%;
  object-fit: cover;
  display: block;
}
.hero-placeholder {
  width: 100%; height: 100%;
  display: flex; align-items: center; justify-content: center;
  background: oklch(0.35 0.10 var(--hue, 30));
  color: oklch(0.95 0.02 var(--hue, 30));
  font-size: 22px; font-weight: var(--w-bold);
  border-radius: 8px;
}
.detail-header-meta { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 4px; }
.detail-agent-row {
  display: flex; align-items: center; justify-content: space-between;
  gap: 10px;
}
.detail-agent { font-size: 20px; font-weight: var(--w-semibold); color: var(--ink); line-height: 1.2; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.match-result-pill.is-detail {
  font-size: 13px;
  padding: 3px 10px;
  border-radius: 4px;
}
.detail-sub   {
  font-size: 12px; color: var(--ink-2);
  display: flex; align-items: center; gap: 6px;
  min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.detail-sub .mode-icon { flex-shrink: 0; }
.detail-badge {
  display: inline-flex; align-items: center; justify-content: center;
  width: 20px; height: 20px;
  border-radius: 4px;
  font-family: var(--font-mono); font-size: 12px; font-weight: var(--w-bold);
}
.detail-badge.result-win  { color: var(--win);  background: var(--win-soft); }
.detail-badge.result-loss { color: var(--loss); background: var(--loss-soft); }

.detail-stats-row {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
  padding: 12px var(--pad);
  border-bottom: 1px solid var(--border-soft);
  background: var(--surface);
}
.stat-row2 {
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 6px;
}
.stat-cell {
  display: flex; flex-direction: column; align-items: center; gap: 4px;
  padding: 10px 6px;
  background: var(--surface-2);
  border: 1px solid var(--border-soft);
  border-radius: 8px;
}
.stat-icon { color: var(--ink-3); }
.stat-value { font-size: 18px; font-family: var(--font-mono); color: var(--ink); font-weight: var(--w-semibold); }
.stat-label { font-size: 11px; color: var(--ink-3); }
.stat-cell.is-win    .stat-value,
.stat-cell.is-win    .stat-icon  { color: var(--win); }
.stat-cell.is-loss   .stat-value,
.stat-cell.is-loss   .stat-icon  { color: var(--loss); }
.stat-cell.is-assist .stat-value,
.stat-cell.is-assist .stat-icon  { color: var(--warn); }

.detail-section {
  padding: 12px var(--pad);
  display: flex; flex-direction: column;
  gap: 8px;
}
.detail-section + .detail-section { padding-top: 4px; }
.section-title {
  font-size: 13px;
  font-weight: var(--w-semibold);
  color: var(--ink-2);
  padding: 6px 0 6px;
}

.event-stat-cell {
  position: relative;
  display: flex; flex-direction: column; align-items: center; gap: 4px;
  padding: 10px 6px;
  background: var(--surface-2);
  border: 1px solid var(--border-soft);
  border-radius: 8px;
  cursor: pointer;
  font: inherit;
  color: inherit;
  text-align: center;
  transition: background 120ms ease, border-color 120ms ease;
}
.event-stat-cell:hover:not(:disabled) {
  background: var(--surface-3);
  border-color: var(--accent);
}
.event-stat-cell:disabled {
  cursor: default;
  opacity: 0.6;
}
.event-stat-cell .stat-icon { color: var(--ink-3); }
.event-stat-cell .stat-value { font-size: 18px; font-family: var(--font-mono); color: var(--ink); font-weight: var(--w-semibold); }
.event-stat-cell .stat-label { font-size: 11px; color: var(--ink-3); }

.event-stat-cell:not(:disabled)::after {
  content: '';
  position: absolute;
  top: 4px; right: 4px;
  width: 9px; height: 9px;
  background: var(--accent);
  clip-path: polygon(100% 0, 100% 100%, 0 0);
  pointer-events: none;
}

.event-stat-spinner { color: var(--accent); display: flex; align-items: center; justify-content: center; }
.event-stat-spinner .spin { animation: event-spin 0.8s linear infinite; }
@keyframes event-spin { to { transform: rotate(360deg); } }

.event-count-kill, .event-count-death {
  font-size: 11px;
  font-weight: var(--w-medium);
  padding: 2px 6px;
  border-radius: 10px;
  margin-left: 6px;
}
.event-count-kill  { color: var(--win);  background: color-mix(in oklch, var(--win),  transparent 85%); }
.event-count-death { color: var(--loss); background: color-mix(in oklch, var(--loss), transparent 85%); }

.montage-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
}
.montage-grid:has(.montage-card:only-child) {
  grid-template-columns: 1fr;
}
.montage-card {
  position: relative;
  background: var(--surface-2);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius);
  overflow: hidden;
  cursor: pointer;
  transition:
    background 120ms ease-out,
    border-color 120ms ease-out;
}
.montage-card:hover {
  background: var(--surface-3);
  border-color: var(--ink-4);
}
.montage-cover {
  position: relative;
  width: 100%; aspect-ratio: 16 / 9;
  background: var(--bg);
  display: flex; align-items: center; justify-content: center;
  overflow: hidden;
}
.montage-cover .cover-img {
  width: 100%; height: 100%; object-fit: cover;
}
.montage-cover .cover-placeholder {
  font-size: 36px; font-weight: var(--w-bold); color: var(--ink-3);
}
.montage-card .btn-play,
.moment-card .btn-play {
  position: absolute; top: 6px; right: 6px;
  background: oklch(0 0 0 / 0.55);
  color: var(--ink);
  border-radius: 50%;
  width: 28px; height: 28px;
  display: flex; align-items: center; justify-content: center;
  font-size: 13px;
  padding: 0;
}
.montage-card .btn-play:hover,
.moment-card .btn-play:hover { background: var(--accent); }
.montage-cover .resolution-chip,
.moment-cover .resolution-chip {
  position: absolute; top: 6px; left: 6px;
  background: oklch(0 0 0 / 0.55);
  color: var(--ink);
  border-radius: 3px;
  padding: 1px 6px;
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: var(--w-semibold);
  letter-spacing: 0.02em;
  pointer-events: none;
}
.montage-info, .moment-info {
  padding: 6px 8px 8px;
  display: flex; flex-direction: column; gap: 1px;
}
.montage-title, .moment-name {
  font-size: 12px; color: var(--ink); font-weight: var(--w-medium);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.montage-meta, .moment-duration {
  font-size: 10px; color: var(--ink-3); font-family: var(--font-mono);
}

.moment-chips {
  display: flex; flex-wrap: wrap; gap: 6px;
  padding: 2px 0;
}
.moment-chip {
  font: inherit; font-size: 12px;
  padding: 4px 10px;
  border-radius: 999px;
  background: var(--surface-2);
  border: 1px solid var(--border-soft);
  color: var(--ink-2);
  font-family: var(--font-sans);
  cursor: pointer;
  transition:
    background 100ms ease-out,
    color 100ms ease-out,
    border-color 100ms ease-out,
    transform 120ms cubic-bezier(0.16, 1, 0.3, 1);
}
.moment-chip:hover {
  color: var(--ink);
  border-color: var(--ink-4);
  transform: translateY(-1px);
}
.moment-chip:active { transform: translateY(0) scale(0.96); }
.moment-chip.is-active {
  background: var(--accent-soft);
  border-color: var(--accent);
  color: var(--accent);
}
.moment-chip.is-active:hover {
  color: var(--accent-hi);
  border-color: var(--accent-hi);
}

.moment-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
}
.moment-card {
  position: relative;
  background: var(--surface-2);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius);
  overflow: hidden;
  cursor: pointer;
  transition:
    background 120ms ease-out,
    border-color 120ms ease-out;
}
.moment-card:hover {
  background: var(--surface-3);
  border-color: var(--ink-4);
}
.moment-cover {
  width: 100%; aspect-ratio: 16 / 9;
  background: var(--bg);
  display: flex; align-items: center; justify-content: center;
  overflow: hidden;
}
.moment-cover .cover-img {
  width: 100%; height: 100%; object-fit: cover;
}
.moment-cover .cover-placeholder {
  font-size: 28px; font-weight: var(--w-bold); color: var(--ink-3);
}
</style>
