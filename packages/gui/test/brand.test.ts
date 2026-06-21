import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { BRAND_LOGO_URL, BRAND_NAME, BRAND_NAME_ACCENT, BRAND_NAME_BASE } from '../src/app.ts';

describe('brand assets', () => {
  test('uses a project logo asset for the WonderfulUI brand', () => {
    expect(BRAND_NAME).toBe('WonderfulUI');
    expect(BRAND_NAME_BASE).toBe('Wonderful');
    expect(BRAND_NAME_ACCENT).toBe('UI');
    expect(BRAND_LOGO_URL).toContain('/assets/logo.svg');
  });

  test('uses the same logo for the browser favicon', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    expect(html).toContain('href="/src/assets/logo.svg"');
  });

  test('keeps the brand logo tied to the theme red accent', () => {
    const svg = readFileSync(new URL('../src/assets/logo.svg', import.meta.url), 'utf8');
    expect(svg).toContain('#e5483f');
  });

  test('sizes the brand logo as an app mark instead of a favicon', () => {
    const css = readFileSync(new URL('../src/components/layout/TopBar.vue', import.meta.url), 'utf8');
    const svg = readFileSync(new URL('../src/assets/logo.svg', import.meta.url), 'utf8');

    expect(css).toMatch(/\.brand\s*{[^}]*gap:\s*8px;/);
    expect(css).toMatch(/\.brand-logo\s*{[\s\S]*width:\s*36px;[\s\S]*height:\s*36px;/);
    expect(svg).toContain('<rect x="4" y="4" width="56" height="56"');
  });
});
