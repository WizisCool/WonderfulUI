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
