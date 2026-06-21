import { defineStore } from 'pinia';
import { ref } from 'vue';

export const useUiStore = defineStore('ui', () => {
  const toastMessage = ref('');
  const toastKind = ref<'ok' | 'error'>('ok');
  const toastVisible = ref(false);
  let toastTimer: number | null = null;

  function showToast(message: string, kind: 'ok' | 'error' = 'ok') {
    if (toastTimer !== null) clearTimeout(toastTimer);
    toastMessage.value = message;
    toastKind.value = kind;
    toastVisible.value = true;
    toastTimer = window.setTimeout(() => {
      toastVisible.value = false;
    }, kind === 'error' ? 6000 : 2500);
  }

  return { toastMessage, toastKind, toastVisible, showToast };
});
