import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const guiRoot = join(import.meta.dir, '..');

function source(relativePath: string): string {
  return readFileSync(join(guiRoot, relativePath), 'utf8');
}

describe('low-frequency bundle boundaries', () => {
  test('settings is lazy in both app shell and router', () => {
    const app = source('src/App.vue');
    const router = source('src/router/index.ts');
    expect(app).toContain("defineAsyncComponent(() => import('./views/SettingsView.vue'))");
    expect(app).toContain('<SettingsView v-if="settings.isOpen" />');
    expect(app).not.toContain("import SettingsView from './views/SettingsView.vue'");
    expect(router).toContain("component: () => import('../views/SettingsView.vue')");
    expect(router).not.toContain("import SettingsView from '../views/SettingsView.vue'");
  });

  test('ECharts registers only chart modules used by the current UI', () => {
    const register = source('src/charts/register.ts');
    expect(register).toContain('PieChart');
    for (const speculative of [
      'BarChart',
      'LineChart',
      'GridComponent',
      'DatasetComponent',
      'DataZoomComponent',
      'TitleComponent',
    ]) {
      expect(register).not.toContain(speculative);
    }
  });
});
