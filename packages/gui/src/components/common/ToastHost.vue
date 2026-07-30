<template>
  <div id="toast-host">
    <TransitionGroup name="toast">
      <div
        v-for="t in toasts"
        :key="t.id"
        :class="['toast', t.kind]"
        :role="t.kind === 'error' ? 'alert' : 'status'"
        :aria-live="t.kind === 'error' ? 'assertive' : 'polite'"
      >{{ t.message }}</div>
    </TransitionGroup>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onUnmounted } from 'vue';
import { useUiStore } from '../../stores/ui.ts';

interface Toast {
  id: number;
  message: string;
  kind: 'ok' | 'error';
}

const ui = useUiStore();
const toasts = ref<Toast[]>([]);
let nextId = 0;
const removalTimers = new Set<number>();

function show(message: string, kind: 'ok' | 'error' = 'ok') {
  const id = nextId++;
  toasts.value.push({ id, message, kind });
  const duration = kind === 'error' ? 6000 : 2500;
  const timer = window.setTimeout(() => {
    removalTimers.delete(timer);
    toasts.value = toasts.value.filter(t => t.id !== id);
  }, duration);
  removalTimers.add(timer);
}

watch(
  () => ui.toastSeq,
  (seq) => {
    if (seq > 0) show(ui.toastMessage, ui.toastKind);
  },
  // Sync prevents Vue from coalescing multiple showToast() calls in one tick;
  // immediate recovers the latest boot error emitted before ToastHost mounts.
  { flush: 'sync', immediate: true },
);

// Expose for use by other components
(window as unknown as Record<string, unknown>).__wuiToast = show;

onUnmounted(() => {
  for (const timer of removalTimers) window.clearTimeout(timer);
  removalTimers.clear();
  delete (window as unknown as Record<string, unknown>).__wuiToast;
});
</script>
