/**
 * Register local Iconify collections so icons render offline in Tauri WebView2
 * without calling api.iconify.design (player / late-mounted modals otherwise
 * show empty slots when the CDN is unreachable).
 */
import { addCollection } from '@iconify/vue';
import { phLocal } from './ph-local.ts';

let registered = false;

export function registerAppIcons(): void {
  if (registered) return;
  addCollection(phLocal);
  registered = true;
}
