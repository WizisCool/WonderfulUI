import { beforeEach } from 'vitest';
import { registerAppIcons } from '../src/icons/register.ts';

// Component tests do not execute main.ts, so register the same offline icon
// subset explicitly. Otherwise Iconify attempts CDN fetches for each WIcon and
// happy-dom reports noisy AbortErrors while tearing the window down.
registerAppIcons();

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number { return this.values.size; }

  clear(): void { this.values.clear(); }

  getItem(key: string): string | null { return this.values.get(String(key)) ?? null; }

  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }

  removeItem(key: string): void { this.values.delete(String(key)); }

  setItem(key: string, value: string): void {
    this.values.set(String(key), String(value));
  }
}

// Node 25 exposes an incomplete global localStorage unless it receives a
// persistence path. Keep component tests deterministic and cross-platform.
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: new MemoryStorage(),
});

beforeEach(() => {
  localStorage.clear();
});
