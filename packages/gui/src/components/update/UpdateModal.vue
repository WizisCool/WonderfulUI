<script setup lang="ts">
// 应用内自更新弹窗。
//
// 设计要点：
// - 模态范式沿用 ShareModal / SettingsView：Teleport to body + Transition + 卡片。
// - 关闭契约：仅 available / error 态可关；downloading / installing 禁用关闭
//   （× 不渲染、Esc 拦截但不 dismiss、backdrop @click.self 短路），
//   防止半途丢弃 update 句柄导致用户卡在中间态。
// - 进度条：transform scaleX（非 width），符合项目 GPU compositing 规范。
// - contentLength 缺失时下载态走 indeterminate shimmer，避免卡在 0%。
// - 不在打开时 programmatically focus 主按钮：WebView2 会把 .focus() 画成
//   *:focus-visible 红框（「键盘选择器」假象）。Tab 进入仍走 :focus-visible。

import { computed, onMounted, onUnmounted } from 'vue';
import WIcon from '../common/WIcon.vue';
import { useUpdateStore } from '../../stores/update.ts';
import { APP_VERSION } from '../../utils/version.ts';
import { clientLog } from '../../utils/client-log.ts';

const SCOPE = 'update-modal';

const update = useUpdateStore();

const isOpen = computed(() => update.modalOpen);

const isCloseable = computed(
  () => update.status === 'available' || update.status === 'error',
);

const pctInt = computed(() => Math.floor(update.progress.pct));

/** Content-Length 缺失时 total 为 0，改走 indeterminate。 */
const hasKnownTotal = computed(() => update.progress.total > 0);

function fmtMB(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1);
}

const downloadedMB = computed(() => fmtMB(update.progress.downloaded));
const totalMB = computed(() => fmtMB(update.progress.total));

const showNetworkHint = computed(
  () =>
    update.status === 'error' &&
    (update.errorKind === 'check' || update.errorKind === 'download'),
);

function onKeydown(e: KeyboardEvent) {
  if (e.key !== 'Escape') return;
  if (!update.modalOpen) return;
  if (!isCloseable.value) {
    e.preventDefault();
    e.stopPropagation();
    return;
  }
  e.preventDefault();
  e.stopPropagation();
  update.dismiss();
}

function onBackdrop() {
  if (!isCloseable.value) return;
  update.dismiss();
}

function onRetry() {
  void update.retry();
}

onMounted(() => {
  document.addEventListener('keydown', onKeydown, true);
  clientLog('info', SCOPE, `mount: status=${update.status}`);
});

onUnmounted(() => {
  document.removeEventListener('keydown', onKeydown, true);
});
</script>

<template>
  <Teleport to="body">
    <Transition name="update-modal">
      <div v-if="isOpen" class="update-modal-backdrop" @click.self="onBackdrop">
        <section
          class="update-modal-card"
          role="dialog"
          aria-modal="true"
          aria-labelledby="update-modal-title"
        >
          <button
            v-if="isCloseable"
            class="update-modal-close"
            type="button"
            aria-label="关闭"
            @click="update.dismiss()"
          >
            <WIcon icon="ph:x" :size="16" />
          </button>

          <!-- available: 发现新版本 -->
          <template v-if="update.status === 'available'">
            <header class="update-modal-head">
              <div class="update-modal-head-icon" aria-hidden="true">
                <WIcon icon="ph:arrows-clockwise" :size="18" />
              </div>
              <h2 id="update-modal-title" class="update-modal-title">发现新版本</h2>
            </header>
            <div class="update-modal-version-row">
              <span class="update-modal-version-current">v{{ APP_VERSION }}</span>
              <span class="update-modal-version-arrow" aria-hidden="true">→</span>
              <span class="update-modal-version-new">v{{ update.update?.version }}</span>
            </div>
            <div
              v-if="update.update?.body"
              class="update-modal-notes"
            >{{ update.update.body }}</div>
            <div v-else class="update-modal-notes update-modal-notes--empty">
              暂无更新说明
            </div>
            <footer class="update-modal-foot">
              <button
                class="btn update-modal-btn update-modal-btn--muted"
                type="button"
                @click="update.skipThisVersion()"
              >
                跳过此版本
              </button>
              <button
                class="btn update-modal-btn"
                type="button"
                @click="update.dismiss()"
              >
                稍后
              </button>
              <button
                class="btn btn-primary update-modal-btn"
                type="button"
                @click="update.startUpdate()"
              >
                更新
              </button>
            </footer>
          </template>

          <!-- downloading: 有 total 用确定进度，否则 indeterminate -->
          <template v-else-if="update.status === 'downloading'">
            <header class="update-modal-head">
              <h2 id="update-modal-title" class="update-modal-title">正在下载</h2>
              <span v-if="hasKnownTotal" class="update-modal-pct">{{ pctInt }}%</span>
            </header>
            <div class="update-modal-progress">
              <div
                v-if="hasKnownTotal"
                class="update-modal-progress-fill"
                :style="{
                  transform: `scaleX(${Math.max(
                    0,
                    Math.min(1, update.progress.pct / 100),
                  )})`,
                }"
              />
              <div
                v-else
                class="update-modal-progress-shimmer"
                aria-hidden="true"
              />
            </div>
            <div class="update-modal-size">
              <template v-if="hasKnownTotal">
                <span class="update-modal-size-num">已下载 {{ downloadedMB }}</span>
                <span class="update-modal-size-sep">/</span>
                <span class="update-modal-size-num">{{ totalMB }} MB</span>
              </template>
              <template v-else>
                <span class="update-modal-size-num">已下载 {{ downloadedMB }} MB</span>
              </template>
            </div>
            <footer class="update-modal-foot update-modal-foot--center">
              <button class="btn update-modal-btn" type="button" disabled>
                下载中…
              </button>
            </footer>
          </template>

          <!-- installing: indeterminate shimmer -->
          <template v-else-if="update.status === 'installing'">
            <header class="update-modal-head">
              <h2 id="update-modal-title" class="update-modal-title">正在安装</h2>
            </header>
            <div class="update-modal-progress">
              <div class="update-modal-progress-shimmer" aria-hidden="true" />
            </div>
            <div class="update-modal-hint">安装完成后将自动重启</div>
            <footer class="update-modal-foot update-modal-foot--center">
              <button class="btn update-modal-btn" type="button" disabled>
                安装中…
              </button>
            </footer>
          </template>

          <!-- error: 重试按 errorKind 分流（store.retry） -->
          <template v-else-if="update.status === 'error'">
            <header class="update-modal-head">
              <div
                class="update-modal-head-icon update-modal-head-icon--error"
                aria-hidden="true"
              >
                <WIcon icon="ph:warning" :size="18" />
              </div>
              <h2 id="update-modal-title" class="update-modal-title">更新失败</h2>
            </header>
            <div class="update-modal-error-msg">{{ update.error }}</div>
            <div v-if="showNetworkHint" class="update-modal-error-hint">
              请检查网络后重试
            </div>
            <footer class="update-modal-foot">
              <button
                class="btn btn-primary update-modal-btn"
                type="button"
                @click="onRetry"
              >
                重试
              </button>
              <button
                class="btn update-modal-btn"
                type="button"
                @click="update.dismiss()"
              >
                关闭
              </button>
            </footer>
          </template>

          <!-- checking: 手动检查中（极少弹窗，但 openModal 后可能见到） -->
          <template v-else-if="update.status === 'checking'">
            <header class="update-modal-head">
              <h2 id="update-modal-title" class="update-modal-title">正在检查更新</h2>
            </header>
            <div class="update-modal-progress">
              <div class="update-modal-progress-shimmer" aria-hidden="true" />
            </div>
            <footer class="update-modal-foot update-modal-foot--center">
              <button class="btn update-modal-btn" type="button" disabled>
                检查中…
              </button>
            </footer>
          </template>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* 视觉词汇表（完全沿用 ShareModal / SettingsView / BootOverlay）：
   - backdrop oklch(0 0 0 / 0.66) + 150/120ms
   - 卡片 var(--surface) + var(--border) + var(--radius-lg) + 0 16px 48px shadow
   - 进度条参考 .boot-progress（BootOverlay）
   - z-index 1400（Settings 1300 之上, Toast 1500 之下）*/
.update-modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1400;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: oklch(0 0 0 / 0.66);
  animation: update-backdrop-in 150ms ease-out both;
}
.update-modal-card {
  position: relative;
  width: 400px;
  max-width: calc(100vw - 32px);
  max-height: calc(100vh - 48px);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 24px 22px 18px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  box-sizing: border-box;
  overflow: hidden;
  animation: update-modal-in 170ms cubic-bezier(0.16, 1, 0.3, 1) both;
  transform-origin: 50% 48%;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.5);
}
.update-modal-leave-active {
  animation: update-backdrop-out 120ms ease-in both;
}
.update-modal-leave-active .update-modal-card {
  animation: update-modal-out 120ms ease-in both;
}

.update-modal-close {
  position: absolute;
  top: 10px;
  right: 10px;
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  background: transparent;
  color: var(--ink-3);
  cursor: pointer;
  border-radius: var(--radius);
  transition:
    background 80ms ease-out,
    color 80ms ease-out;
}
.update-modal-close:hover {
  background: var(--surface-2);
  color: var(--ink);
}

.update-modal-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding-right: 28px;
}
.update-modal-head-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: var(--radius);
  background: oklch(0.62 0.21 25 / 0.12);
  color: var(--accent);
  flex-shrink: 0;
}
.update-modal-head-icon--error {
  background: oklch(0.66 0.18 25 / 0.12);
  color: var(--loss);
}
.update-modal-title {
  margin: 0;
  font-size: 16px;
  font-weight: var(--w-semibold);
  color: var(--ink);
  letter-spacing: 0.3px;
}
.update-modal-pct {
  margin-left: auto;
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-size: 14px;
  font-weight: var(--w-semibold);
  color: var(--accent);
}

.update-modal-version-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-size: 14px;
  flex-wrap: wrap;
}
.update-modal-version-current {
  color: var(--ink-3);
}
.update-modal-version-arrow {
  color: var(--ink-4);
}
.update-modal-version-new {
  color: var(--accent);
  font-weight: var(--w-bold);
}

.update-modal-notes {
  max-height: 220px;
  overflow: auto;
  padding: 10px 12px;
  background: var(--surface-2);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius);
  color: var(--ink-2);
  font-family: var(--font-sans);
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  user-select: text;
  scrollbar-width: thin;
  scrollbar-color: var(--border) transparent;
}
.update-modal-notes--empty {
  color: var(--ink-3);
  font-style: italic;
  text-align: center;
}
.update-modal-notes::-webkit-scrollbar { width: 8px; height: 8px; }
.update-modal-notes::-webkit-scrollbar-track { background: transparent; }
.update-modal-notes::-webkit-scrollbar-thumb {
  background: var(--border);
  border-radius: 4px;
  border: 2px solid transparent;
  background-clip: padding-box;
}

.update-modal-progress {
  position: relative;
  width: 100%;
  height: 6px;
  background: var(--surface-2);
  border-radius: 999px;
  overflow: hidden;
}
.update-modal-progress-fill {
  position: absolute;
  inset: 0;
  background: var(--accent);
  transform-origin: left center;
  transform: scaleX(0);
  border-radius: 999px;
  transition: transform 500ms cubic-bezier(0.4, 0, 0.2, 1);
  will-change: transform;
}
.update-modal-progress-shimmer {
  position: absolute;
  top: 0;
  left: 0;
  width: 40%;
  height: 100%;
  background: linear-gradient(
    90deg,
    transparent 0%,
    var(--accent) 50%,
    transparent 100%
  );
  border-radius: 999px;
  animation: update-progress-shimmer 1.6s cubic-bezier(0.4, 0, 0.2, 1) infinite;
  opacity: 0.6;
}

.update-modal-size {
  display: flex;
  align-items: baseline;
  gap: 6px;
  font-size: 12px;
  color: var(--ink-3);
}
.update-modal-size-num {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  color: var(--ink-2);
}
.update-modal-size-sep {
  color: var(--ink-4);
}

.update-modal-hint {
  font-size: 12px;
  color: var(--ink-3);
  text-align: center;
}

.update-modal-error-msg {
  padding: 10px 12px;
  background: oklch(0.66 0.18 25 / 0.08);
  border: 1px solid oklch(0.66 0.18 25 / 0.28);
  border-radius: var(--radius);
  color: var(--ink-2);
  font-family: var(--font-sans);
  font-size: 13px;
  line-height: 1.55;
  user-select: text;
  word-break: break-word;
}
.update-modal-error-hint {
  font-size: 12px;
  color: var(--ink-3);
  text-align: center;
  margin-top: -4px;
}

.update-modal-foot {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding-top: 4px;
}
.update-modal-foot--center {
  justify-content: center;
}
.update-modal-btn {
  min-width: 84px;
}
.update-modal-btn--muted {
  margin-right: auto;
  color: var(--ink-3);
  min-width: 0;
}
.update-modal-btn--muted:hover {
  color: var(--ink-2);
  background: var(--surface-2);
}
.update-modal-btn:disabled {
  opacity: 0.65;
  cursor: default;
}

@keyframes update-backdrop-in {
  from { opacity: 0; }
  to   { opacity: 1; }
}
@keyframes update-backdrop-out {
  from { opacity: 1; }
  to   { opacity: 0; }
}
@keyframes update-modal-in {
  from { opacity: 0; transform: scale(0.96) translateY(8px); }
  to   { opacity: 1; transform: scale(1) translateY(0); }
}
@keyframes update-modal-out {
  from { opacity: 1; transform: scale(1) translateY(0); }
  to   { opacity: 0; transform: scale(0.96) translateY(8px); }
}
@keyframes update-progress-shimmer {
  0%   { transform: translateX(-100%); }
  100% { transform: translateX(250%); }
}

@media (max-width: 480px) {
  .update-modal-backdrop { padding: 16px; }
  .update-modal-card { width: calc(100vw - 24px); }
}
</style>
