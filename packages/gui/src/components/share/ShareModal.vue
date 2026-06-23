<script setup lang="ts">
// "快传" QR 分享模态（v5 最终版）。
//
// 用户行为：
// 1. 点播放器"分享" → 模态弹出，server 启动
// 2. 手机扫码 → 浏览器下载 .mp4
// 3. **用户主动关模态（点 × 或点遮罩）→ server 关闭**
//
// 重要决策（v5）：
// - **server 生命周期 = 模态生命周期**：模态挂载时启动、卸载时关闭。
//   之前"下载完成 1s 自动关"被删除 —— 微信场景下用户可能还没下载完
//   或者根本不需要下载（只看预览），让用户自己决定什么时候关。
// - **3 分钟空闲兜底**仍在 Rust 端：防止用户开模态后没关、session 挂
//   着没人收，端口被长占。这是唯一保留的自动关路径。
// - QR 点击复制链接：整块 QR 框是 <button>，点击后 1.5s 显示"已复制 ✓"。

import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useShareStore } from '../../stores/share.ts';
import { useUiStore } from '../../stores/ui.ts';
import { listen } from '../../tauri-adapter.ts';
import { clientLog } from '../../utils/client-log.ts';

const props = defineProps<{
  videoPath: string;
  videoName: string;
}>();

const emit = defineEmits<{
  close: [];
}>();

const share = useShareStore();
const ui = useUiStore();

const isOpen = computed(() => share.status !== 'idle' || share.info !== null);

const formattedSize = computed(() => {
  const bytes = share.info?.videoSize ?? 0;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
});

const statusText = computed(() => {
  if (share.downloadCount === 0) return '等待扫码';
  return '下载完成';
});

let unlistenStopped: (() => void) | null = null;
let unlistenDownloaded: (() => void) | null = null;
let copyCooldown = ref(0); // QR 复制防抖

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    close();
  }
}

onMounted(async () => {
  clientLog('info', 'share-modal', `mount: path=${props.videoPath}`);
  // Esc 键关闭模态（同时关 server —— 由 onUnmounted 触发）。
  // capture 阶段拦截，避免其他组件先消费 Esc。PlayerHost 自己的
  // Esc 处理在 onKeydown（无 capture）里，两边不会冲突 —— 我们
  // stopPropagation 之后 PlayerHost 看不到 Esc。
  document.addEventListener('keydown', onKeydown, true);

  unlistenDownloaded = await listen<{ count: number; filename: string; sizeBytes: number }>(
    'wui://share_downloaded',
    (e) => {
      clientLog(
        'info',
        'share-modal',
        `download event: count=${e.payload.count} size=${e.payload.sizeBytes}`,
      );
      share.onDownloaded(e.payload);
    },
  );
  unlistenStopped = await listen<{ reason: 'stopped' | 'error' | 'idle_timeout'; message?: string }>(
    'wui://share_server_stopped',
    (e) => {
      clientLog(
        'info',
        'share-modal',
        `server stopped: reason=${e.payload.reason}${e.payload.message ? ' msg=' + e.payload.message : ''}`,
      );
      // 3 分钟空闲兜底触发的停止：仅记日志 + toast，**不**自动关模态。
      // 如果是 error 路径：toast 错误信息，模态保留（用户能看错误）。
      // "stopped" 路径不应该到这里 —— 我们自己通过 emit('close') 关
      // 模态，那条路径会调 share.stop() 显式停 server。
      share.onStopped(e.payload.reason, e.payload.message);
      if (e.payload.reason === 'error' && e.payload.message) {
        ui.showToast(`快传已停止: ${e.payload.message}`, 'error');
      } else if (e.payload.reason === 'idle_timeout') {
        // 兜底关闭：用户没手动关就超时了
        ui.showToast('快传端口已闲置超时', 'ok');
        emit('close');
      }
    },
  );

  // 启动 server（模态生命周期 = server 生命周期）
  await share.start(props.videoPath);
  if (share.status === 'error') {
    clientLog('error', 'share-modal', `start failed: ${share.lastError}`);
    ui.showToast(`启动快传失败: ${share.lastError}`, 'error');
    emit('close');
  } else if (share.info) {
    clientLog(
      'info',
      'share-modal',
      `server up: port=${share.info.port} ip=${share.info.lanIp}`,
    );
  }
});

onUnmounted(() => {
  clientLog('info', 'share-modal', 'unmount → stopping server');
  unlistenDownloaded?.();
  unlistenStopped?.();
  document.removeEventListener('keydown', onKeydown, true);
  // **关模态 → 关 server**：避免端口长占
  share.stop();
});

async function copyLink() {
  if (!share.info) return;
  if (copyCooldown.value > 0) return;
  try {
    await navigator.clipboard.writeText(share.info.url);
    clientLog('info', 'share-modal', 'copy link to clipboard');
    copyCooldown.value = 1500;
    setTimeout(() => (copyCooldown.value = 0), 1500);
  } catch (e) {
    clientLog('warn', 'share-modal', `copy failed: ${e}`);
    ui.showToast('复制失败，请手动选择', 'error');
  }
}

function close() {
  clientLog('info', 'share-modal', 'close requested (× / Esc / backdrop)');
  emit('close');
}
</script>

<template>
  <Teleport to="body">
    <Transition name="share-modal">
      <div v-if="isOpen" class="share-modal-backdrop" @click.self="close">
        <section class="share-modal-card" role="dialog" aria-modal="true">
          <button class="share-modal-close" aria-label="关闭" @click="close">×</button>

          <div v-if="share.status === 'starting'" class="share-modal-state">
            <div class="share-spinner" />
            <p>正在启动快传…</p>
          </div>

          <div v-else-if="share.status === 'error'" class="share-modal-state">
            <p class="share-modal-error">启动失败：{{ share.lastError }}</p>
            <button class="share-btn" @click="close">关闭</button>
          </div>

          <template v-else-if="share.info">
            <header class="share-modal-head">
              <div class="share-modal-brand">
                <span class="share-modal-brand-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                    <path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92 1.61 0 2.92-1.31 2.92-2.92s-1.31-2.92-2.92-2.92z"/>
                  </svg>
                </span>
                <h2 class="share-modal-title">快传</h2>
              </div>
              <p class="share-modal-sub">扫码即可在同 WiFi 设备上下载</p>
            </header>

            <!-- QR 框：点击整体复制链接（替代之前的 URL 块） -->
            <button
              type="button"
              class="share-modal-qr-frame"
              :class="{ 'is-copied': copyCooldown > 0 }"
              :title="share.info.url + '（点击复制）'"
              @click="copyLink"
            >
              <div class="share-modal-qr" v-html="share.info.qrSvg" />
              <span class="share-modal-qr-hint" aria-hidden="true">
                {{ copyCooldown > 0 ? '已复制 ✓' : '点击复制链接' }}
              </span>
            </button>

            <!-- 状态行：文件大小 · 状态（红点呼吸 + 文字） -->
            <div class="share-modal-status-row">
              <span class="share-modal-size">{{ formattedSize }}</span>
              <span class="share-modal-sep">·</span>
              <span class="share-modal-status">
                <span class="share-modal-status-dot" :class="{ 'is-active': share.downloadCount > 0 }" />
                <span class="share-modal-status-text">{{ statusText }}</span>
              </span>
            </div>

            <!-- 进度条：等待时 indeterminate 呼吸光带，下载完成后填充 -->
            <div class="share-modal-progress">
              <div
                v-if="share.downloadCount === 0"
                class="share-modal-progress-shimmer"
                aria-hidden="true"
              />
              <div
                class="share-modal-progress-fill"
                :style="{ transform: share.downloadCount > 0 ? 'scaleX(1)' : 'scaleX(0)' }"
              />
            </div>
          </template>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* 沿用项目 Settings modal / BootOverlay 的视觉词汇表：
   - backdrop oklch(0 0 0 / 0.66) + 150/120ms
   - 卡片 var(--surface) + var(--border) + var(--radius-lg)
   - 进度条参考 .boot-progress（BootOverlay.vue 加载态）：
     height 6px, border-radius 999px, accent fill, cubic-bezier(0.4,0,0.2,1)
   - 动效 cubic-bezier(0.16, 1, 0.3, 1) 170/120ms */
.share-modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1500;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: oklch(0 0 0 / 0.66);
  animation: share-backdrop-in 150ms ease-out both;
}
.share-modal-card {
  position: relative;
  width: 360px;
  max-width: calc(100vw - 32px);
  max-height: calc(100vh - 48px);
  background: var(--surface, #1f1f23);
  border: 1px solid var(--border, #3a3a40);
  border-radius: var(--radius-lg, 10px);
  padding: 28px 24px 22px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  box-sizing: border-box;
  overflow-y: auto;
  animation: share-modal-in 170ms cubic-bezier(0.16, 1, 0.3, 1) both;
  transform-origin: 50% 48%;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.5);
}
.share-modal-leave-active {
  animation: share-backdrop-out 120ms ease-in both;
}
.share-modal-leave-active .share-modal-card {
  animation: share-modal-out 120ms ease-in both;
}

.share-modal-close {
  position: absolute;
  top: 10px;
  right: 10px;
  width: 28px;
  height: 28px;
  border: 0;
  background: transparent;
  font-size: 20px;
  line-height: 1;
  color: var(--ink-3, #999);
  cursor: pointer;
  border-radius: var(--radius, 6px);
  transition: background 80ms ease-out, color 80ms ease-out;
}
.share-modal-close:hover {
  background: var(--surface-2, #2a2a30);
  color: var(--ink, #f0f0f0);
}

.share-modal-head {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding-right: 28px;
}
.share-modal-brand {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--accent, #d04040);
}
.share-modal-brand-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: var(--radius, 6px);
  background: oklch(0.62 0.21 25 / 0.12);
  color: var(--accent, #d04040);
}
.share-modal-title {
  margin: 0;
  font-size: 18px;
  font-weight: var(--w-semibold, 600);
  color: var(--ink, #f0f0f0);
  letter-spacing: 0.5px;
}
.share-modal-sub {
  margin: 0;
  font-size: 12px;
  color: var(--ink-3, #999);
  text-align: center;
}

/* QR 框：240×240，整块可点击复制；hover 微微亮；copied 态边框变红 */
.share-modal-qr-frame {
  position: relative;
  width: 240px;
  height: 240px;
  flex-shrink: 0;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
  border-radius: 10px;
  transition: transform 80ms ease-out;
}
.share-modal-qr-frame:active {
  transform: scale(0.98);
}
.share-modal-qr {
  width: 100%;
  height: 100%;
  background: #fff;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  box-shadow: 0 0 0 1px var(--border-soft, #2a2a30),
    0 4px 16px rgba(0, 0, 0, 0.3);
  transition: box-shadow 120ms ease-out, transform 120ms ease-out;
}
.share-modal-qr-frame:hover .share-modal-qr {
  box-shadow: 0 0 0 2px var(--accent, #d04040),
    0 4px 20px rgba(0, 0, 0, 0.4);
}
.share-modal-qr-frame.is-copied .share-modal-qr {
  box-shadow: 0 0 0 2px var(--accent, #d04040),
    0 0 24px oklch(0.62 0.21 25 / 0.4);
}
.share-modal-qr :deep(svg) {
  width: 100%;
  height: 100%;
  display: block;
}
/* QR 上叠加的 hint —— "点击复制链接"，hover/copied 时切换文案 */
.share-modal-qr-hint {
  position: absolute;
  bottom: 8px;
  left: 50%;
  transform: translateX(-50%);
  padding: 4px 10px;
  background: oklch(0 0 0 / 0.65);
  color: #fff;
  border-radius: var(--radius-pill, 999px);
  font-size: 11px;
  font-weight: var(--w-medium, 500);
  letter-spacing: 0.3px;
  pointer-events: none;
  opacity: 0;
  transform: translateX(-50%) translateY(4px);
  transition: opacity 160ms ease-out, transform 160ms ease-out;
}
.share-modal-qr-frame:hover .share-modal-qr-hint,
.share-modal-qr-frame.is-copied .share-modal-qr-hint {
  opacity: 1;
  transform: translateX(-50%) translateY(0);
}

/* 状态行：大小 + 状态（点 + 文字） */
.share-modal-status-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--ink-3, #999);
}
.share-modal-size {
  font-family: var(--font-mono, monospace);
  font-variant-numeric: tabular-nums;
  color: var(--ink, #f0f0f0);
}
.share-modal-sep {
  color: var(--ink-4, #666);
}
.share-modal-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
/* 等待扫码 = 灰色呼吸（克制、不打扰） */
.share-modal-status-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--ink-3, #999);
  box-shadow: 0 0 0 4px oklch(0.78 0.012 30 / 0.10);
  animation: share-status-pulse 1.2s ease-in-out infinite;
}
/* 下载完成 = 红色 + 更大呼吸范围（强调"成功"） */
.share-modal-status-dot.is-active {
  background: var(--accent, #d04040);
  box-shadow: 0 0 0 6px oklch(0.62 0.21 25 / 0.25);
  animation: share-status-active 1.2s ease-in-out infinite;
}
@keyframes share-status-pulse {
  0%, 100% {
    box-shadow: 0 0 0 4px oklch(0.78 0.012 30 / 0.10);
    transform: scale(1);
  }
  50% {
    box-shadow: 0 0 0 8px oklch(0.78 0.012 30 / 0.03);
    transform: scale(1.1);
  }
}
@keyframes share-status-active {
  0%, 100% {
    box-shadow: 0 0 0 6px oklch(0.62 0.21 25 / 0.25);
    transform: scale(1);
  }
  50% {
    box-shadow: 0 0 0 10px oklch(0.62 0.21 25 / 0.08);
    transform: scale(1.2);
  }
}
.share-modal-status-text {
  color: var(--ink-2, #c8c8d0);
}
.share-modal-status-dot.is-active + .share-modal-status-text {
  color: var(--accent, #d04040);
  font-weight: var(--w-medium, 500);
}

/* 进度条 —— 完全沿用 .boot-progress 的样式（BootOverlay 加载态） */
.share-modal-progress {
  position: relative;
  width: 100%;
  height: 6px;
  background: var(--surface-2, #2a2a30);
  border-radius: 999px;
  overflow: hidden;
}
.share-modal-progress-fill {
  position: absolute;
  inset: 0;
  background: var(--accent, #d04040);
  transform-origin: left center;
  transform: scaleX(0);
  border-radius: 999px;
  transition: transform 500ms cubic-bezier(0.4, 0, 0.2, 1);
}
.share-modal-progress[data-state="done"] .share-modal-progress-fill {
  /* 完成态不强制 100%，由 :style transform 决定 */
}
/* indeterminate 等待光带：左→右循环移动 */
.share-modal-progress-shimmer {
  position: absolute;
  top: 0;
  left: 0;
  width: 40%;
  height: 100%;
  background: linear-gradient(
    90deg,
    transparent 0%,
    var(--accent, #d04040) 50%,
    transparent 100%
  );
  border-radius: 999px;
  animation: share-progress-shimmer 1.6s cubic-bezier(0.4, 0, 0.2, 1) infinite;
  opacity: 0.6;
}
@keyframes share-progress-shimmer {
  0%   { transform: translateX(-100%); }
  100% { transform: translateX(250%); }
}
@media (prefers-reduced-motion: reduce) {
  .share-modal-progress-shimmer,
  .share-modal-progress-fill {
    animation-duration: 1ms !important;
    transition-duration: 1ms !important;
  }
}

.share-modal-state {
  padding: 32px 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  color: var(--ink-2, #c8c8d0);
  text-align: center;
}
.share-modal-error {
  color: oklch(0.85 0.18 25);
}

.share-btn {
  height: 30px;
  padding: 0 14px;
  border: 1px solid var(--border-soft, #383840);
  background: transparent;
  color: var(--ink-2, #c8c8d0);
  border-radius: var(--radius, 6px);
  font-size: 12px;
  cursor: pointer;
  transition: background 80ms ease-out, border-color 80ms ease-out, color 80ms ease-out;
}
.share-btn:hover {
  background: var(--surface-2, #2a2a30);
  color: var(--ink, #f0f0f0);
}

.share-spinner {
  width: 24px;
  height: 24px;
  border: 2px solid var(--border-soft, #383840);
  border-top-color: var(--accent, #d04040);
  border-radius: 50%;
  animation: share-spin 800ms linear infinite;
}

@keyframes share-backdrop-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes share-backdrop-out { from { opacity: 1; } to { opacity: 0; } }
@keyframes share-modal-in {
  from { opacity: 0; transform: scale(0.96) translateY(8px); }
  to   { opacity: 1; transform: scale(1) translateY(0); }
}
@keyframes share-modal-out {
  from { opacity: 1; transform: scale(1) translateY(0); }
  to   { opacity: 0; transform: scale(0.96) translateY(8px); }
}
@keyframes share-spin { to { transform: rotate(360deg); } }
</style>
