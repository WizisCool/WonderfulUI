/**
 * Shared ECharts registration for WonderfulUI settings (and future dashboards).
 *
 * Register chart types / components once here. Settings pages import from this
 * module (side-effect) then use `vue-echarts` — never call `echarts.init` by hand.
 *
 * Currently used: pie donut (资料库概览). Register only what ships today;
 * speculative chart types defeat ECharts tree-shaking and make every settings
 * open parse code for features that do not exist.
 */
import { use } from 'echarts/core';
import { PieChart } from 'echarts/charts';
import {
  LegendComponent,
  TooltipComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import VChart from 'vue-echarts';

use([
  // charts
  PieChart,
  // components
  TooltipComponent,
  LegendComponent,
  // renderer
  CanvasRenderer,
]);

export { VChart };
export type { ComposeOption } from 'echarts/core';
