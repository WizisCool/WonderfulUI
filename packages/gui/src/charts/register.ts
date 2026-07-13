/**
 * Shared ECharts registration for WonderfulUI settings (and future dashboards).
 *
 * Register chart types / components once here. Settings pages import from this
 * module (side-effect) then use `vue-echarts` — never call `echarts.init` by hand.
 *
 * Currently used: pie donut (资料库概览).
 * Pre-registered for expansion: bar, line, grid, dataset, dataZoom, title.
 */
import { use } from 'echarts/core';
import { BarChart, LineChart, PieChart } from 'echarts/charts';
import {
  DatasetComponent,
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  TitleComponent,
  TooltipComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import VChart from 'vue-echarts';

use([
  // charts
  PieChart,
  BarChart,
  LineChart,
  // components
  TitleComponent,
  TooltipComponent,
  LegendComponent,
  GridComponent,
  DatasetComponent,
  DataZoomComponent,
  // renderer
  CanvasRenderer,
]);

export { VChart };
export type { ComposeOption } from 'echarts/core';
