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

  const scanOverlayVisible = ref(false);
  const scanOverlayLabel = ref('正在准备全量扫描…');
  const scanOverlayPct = ref(5);

  function showScanOverlay() {
    scanOverlayVisible.value = true;
    scanOverlayLabel.value = '正在准备全量扫描…';
    scanOverlayPct.value = 5;
  }

  function updateScanOverlay(label: string, pct: number) {
    scanOverlayLabel.value = label;
    scanOverlayPct.value = pct;
  }

  function hideScanOverlay() {
    scanOverlayVisible.value = false;
  }

  return { toastMessage, toastKind, toastVisible, showToast,
    scanOverlayVisible, scanOverlayLabel, scanOverlayPct,
    showScanOverlay, updateScanOverlay, hideScanOverlay };
});
