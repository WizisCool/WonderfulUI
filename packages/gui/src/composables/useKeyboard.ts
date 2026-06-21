import { onMounted, onUnmounted } from 'vue';

export function useKeyboard(handler: (e: KeyboardEvent) => void) {
  onMounted(() => document.addEventListener('keydown', handler));
  onUnmounted(() => document.removeEventListener('keydown', handler));
}

export function useKeydown(handler: (e: KeyboardEvent) => void, options?: AddEventListenerOptions) {
  onMounted(() => document.addEventListener('keydown', handler, options));
  onUnmounted(() => document.removeEventListener('keydown', handler, options));
}
