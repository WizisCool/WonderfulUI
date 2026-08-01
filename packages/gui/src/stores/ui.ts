import { defineStore } from 'pinia';
import { ref } from 'vue';

export const useUiStore = defineStore('ui', () => {
  const toastMessage = ref('');
  const toastKind = ref<'ok' | 'error'>('ok');
  /** Monotonic event identity: repeated/equal messages must still render. */
  const toastSeq = ref(0);

  function showToast(message: string, kind: 'ok' | 'error' = 'ok') {
    toastMessage.value = message;
    toastKind.value = kind;
    toastSeq.value += 1;
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

  return { toastMessage, toastKind, toastSeq, showToast,
    scanOverlayVisible, scanOverlayLabel, scanOverlayPct,
    showScanOverlay, updateScanOverlay, hideScanOverlay };
});
