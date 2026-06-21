<template>
  <div id="toast-host">
    <TransitionGroup name="toast">
      <div
        v-for="t in toasts"
        :key="t.id"
        :class="['toast', t.kind]"
      >{{ t.message }}</div>
    </TransitionGroup>
  </div>
</template>

<script setup lang="ts">
import { ref, onUnmounted } from 'vue';

interface Toast {
  id: number;
  message: string;
  kind: 'ok' | 'error';
}

const toasts = ref<Toast[]>([]);
let nextId = 0;

function show(message: string, kind: 'ok' | 'error' = 'ok') {
  const id = nextId++;
  toasts.value.push({ id, message, kind });
  const duration = kind === 'error' ? 6000 : 2500;
  setTimeout(() => {
    toasts.value = toasts.value.filter(t => t.id !== id);
  }, duration);
}

// Expose for use by other components
(window as unknown as Record<string, unknown>).__wuiToast = show;

onUnmounted(() => {
  delete (window as unknown as Record<string, unknown>).__wuiToast;
});
</script>
