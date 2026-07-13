<template>
  <div class="share-chart" role="img" :aria-label="ariaLabel">
    <!--
      VChart owns the canvas lifecycle (init / dispose / resize).
      Center total is a sibling overlay so it never joins pie hover state.
    -->
    <div class="share-chart-plot">
      <VChart
        class="share-chart-canvas"
        :option="chartOption"
        :update-options="chartUpdateOpts"
        autoresize
      />
      <div class="share-chart-center" :key="metricLabel" aria-hidden="true">
        <template v-if="total > 0">
          <span class="share-chart-center-number">{{ total }}</span>
          <span class="share-chart-center-label">{{ metricLabel }}</span>
        </template>
        <template v-else>
          <span class="share-chart-center-empty">{{ emptyLabel }}</span>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue';
import type { EChartsCoreOption } from 'echarts/core';
import { VChart } from '../../charts/register.ts';
import {
  buildAccountShareChartOption,
  CHART_METRIC_EMPTY,
  CHART_METRIC_LABELS,
  type AccountStat,
  type ChartMetric,
} from '../../utils/library-stats.ts';

const props = defineProps<{
  accounts: AccountStat[];
  metric: ChartMetric;
}>();

/** notMerge: full option replace only when we intentionally rebuild. */
const chartUpdateOpts = { notMerge: true as const, lazyUpdate: true };

// Stable option ref: only replace when accounts/metric actually change.
// Feeding a brand-new option object on every parent render + notMerge can
// re-apply the series during hover and look like slice flicker.
const chartOption = shallowRef<EChartsCoreOption>({});
const total = shallowRef(0);

watch(
  () => [props.metric, props.accounts] as const,
  () => {
    const built = buildAccountShareChartOption(props.accounts, props.metric);
    chartOption.value = built.option;
    total.value = built.total;
  },
  { immediate: true, deep: true },
);

const metricLabel = computed(() => CHART_METRIC_LABELS[props.metric]);
const emptyLabel = computed(() => CHART_METRIC_EMPTY[props.metric]);

const ariaLabel = computed(
  () => `按账号展示${metricLabel.value}数量占比的饼图，共 ${total.value} ${metricLabel.value}`,
);
</script>

<style scoped>
.share-chart {
  width: 100%;
  height: 224px;
  min-height: 224px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius);
  background: color-mix(in oklch, var(--bg), transparent 38%);
  overflow: hidden;
}

.share-chart-plot {
  position: relative;
  width: 100%;
  height: 100%;
}

/* vue-echarts root must fill the plot so autoresize measures correctly */
.share-chart-canvas {
  width: 100%;
  height: 100%;
  min-height: 0;
}

.share-chart-center {
  position: absolute;
  left: 34%;
  top: 50%;
  transform: translate(-50%, -50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  pointer-events: none;
  text-align: center;
  line-height: 1.1;
  z-index: 1;
  /* Quiet settle-in; metric toggles remount text via key below. */
  animation: share-center-in 320ms cubic-bezier(0.16, 1, 0.3, 1) both;
}
.share-chart-center-number {
  font-family: var(--font-mono);
  font-size: 18px;
  font-weight: var(--w-semibold);
  color: var(--ink);
  transition: color 160ms ease-out;
}
.share-chart-center-label {
  font-family: var(--font-sans);
  font-size: 12px;
  color: var(--ink-2);
}
.share-chart-center-empty {
  font-family: var(--font-sans);
  font-size: 12px;
  color: var(--ink-3);
  max-width: 5.5em;
}
@keyframes share-center-in {
  from {
    opacity: 0.55;
    transform: translate(-50%, -50%) scale(0.96);
  }
  to {
    opacity: 1;
    transform: translate(-50%, -50%) scale(1);
  }
}

@media (max-width: 760px) {
  .share-chart {
    height: 280px;
    min-height: 280px;
  }
}
</style>
