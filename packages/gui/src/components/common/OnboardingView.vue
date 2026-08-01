<template>
  <main class="onboarding-root" aria-labelledby="onboarding-title">
    <div class="onboarding">
      <header class="onboarding-head">
        <img class="onboarding-logo" :src="brandLogoUrl" alt="" aria-hidden="true" width="48" height="48" decoding="async" />
        <h1 id="onboarding-title" class="onboarding-title">欢迎使用 WonderfulUI</h1>
        <p class="onboarding-sub">
          WonderfulUI 是用于整理和回看本地无畏契约高光的个人资料库。它只读取 ACLOS 已生成的数据，不修改游戏文件；正式版会检查更新，快传只在你主动开启时使用局域网。
        </p>
      </header>

      <section class="onboarding-steps" aria-label="开始步骤">
        <ol class="onboarding-step-list">
          <li class="onboarding-step">
            <span class="onboarding-step-num">1</span>
            <div class="onboarding-step-body">
              <div class="onboarding-step-title">先让 ACLOS 生成本地高光</div>
              <p class="onboarding-step-text">
                WonderfulUI 不会替你录制或生成高光。请先让腾讯 ACLOS/“无畏时刻”在本机生成数据；我们会读取默认 <code>WonderfulDb</code> 目录中的账户文件和可选快照。
              </p>
            </div>
          </li>
          <li class="onboarding-step">
            <span class="onboarding-step-num">2</span>
            <div class="onboarding-step-body">
              <div class="onboarding-step-title">等待高光写入完成</div>
              <p class="onboarding-step-text">
                对局结束后，客户端会异步生成击杀集锦、高光时刻、三杀时刻等视频。生成完成并写入本地后，WonderfulUI 才能把它们加入资料库。
              </p>
            </div>
          </li>
          <li class="onboarding-step">
            <span class="onboarding-step-num">3</span>
            <div class="onboarding-step-body">
              <div class="onboarding-step-title">回到这里刷新资料库</div>
              <p class="onboarding-step-text">
                回到这个窗口，点击对局列表顶部的“刷新”按钮（<WIcon icon="ph:arrows-clockwise" :size="12" />）。新生成的高光会出现在列表中，双击视频即可播放。
              </p>
            </div>
          </li>
        </ol>
      </section>

      <section class="onboarding-status" aria-label="检测状态">
        <div class="onboarding-status-row">
          <span class="onboarding-status-label">数据目录</span>
          <code class="onboarding-status-value onboarding-path">{{ aclos?.dir ?? '—' }}</code>
          <span class="onboarding-status-tag" :class="dirTagClass">{{ dirTagText }}</span>
        </div>
        <div class="onboarding-status-row">
          <span class="onboarding-status-label">账户文件</span>
          <span class="onboarding-status-value">{{ aclos?.hasAccounts ? '已检测到' : '未检测到' }}</span>
        </div>
      </section>

      <footer class="onboarding-foot">
        <button
          class="btn btn-primary onboarding-cta"
          type="button"
          @click="$emit('retry')"
        >
          <WIcon icon="ph:arrows-clockwise" :size="14" />
          重新检测
        </button>
        <button
          class="btn btn-ghost onboarding-settings"
          type="button"
          :data-tip="'当前使用 ACLOS 默认目录，暂不支持更改'"
          @click="onSettings"
          disabled
        >
          <WIcon icon="ph:folder-open" :size="14" />
          数据目录固定
        </button>
      </footer>

      <p class="onboarding-note">
        <WIcon icon="ph:info" :size="12" />
        应用不会上传资料库或修改游戏文件；正式版启动时会检查更新，快传只在你主动开启时使用局域网。
      </p>
    </div>
  </main>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import WIcon from './WIcon.vue';
import { useAccountStore, type AclosStatus } from '../../stores/account.ts';
import { useSettingsStore } from '../../stores/settings.ts';

defineEmits<{
  retry: [];
}>();

const account = useAccountStore();
const settings = useSettingsStore();

const brandLogoUrl = new URL('../../assets/logo.svg', import.meta.url).href;

const aclos = computed<AclosStatus | null>(() => account.aclosStatus);

const dirTagText = computed(() => {
  const s = aclos.value;
  if (!s) return '检测中…';
  if (!s.dirExists) return '目录不存在';
  if (!s.hasAccounts) return '目录为空';
  return '就绪';
});

const dirTagClass = computed(() => {
  const s = aclos.value;
  if (!s) return 'is-pending';
  if (!s.dirExists) return 'is-error';
  if (!s.hasAccounts) return 'is-warn';
  return 'is-ok';
});

function onSettings() {
  // Manual directory selection is a future addition (needs a Tauri
  // dialog plugin + persistence + rescan). Disabled in this pass so
  // users do not see a dead button; settings modal is still reachable
  // from the (now-hidden) top bar.
  settings.setOpen(true);
}
</script>

<style scoped>
.onboarding-root {
  /* Subtle linear-gradient from the page background to a slightly
     warmer tint gives the first-run screen a sense of "this is a
     distinct surface" without resorting to a colored hero gradient
     (which DESIGN.md bans as AI-SaaS). */
  position: relative;
  min-height: 100%;
  background:
    linear-gradient(180deg, var(--bg) 0%, oklch(0.18 0.014 30) 100%);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 64px 32px;
  box-sizing: border-box;
  overflow-y: auto;
}

.onboarding {
  width: 100%;
  max-width: 720px;
  display: flex;
  flex-direction: column;
  gap: 28px;
}

.onboarding-head {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
}

.onboarding-logo {
  width: 48px; height: 48px;
  margin-bottom: 4px;
  flex: 0 0 auto;
}

.onboarding-title {
  font-size: 22px;
  font-weight: var(--w-bold);
  color: var(--ink);
  margin: 0;
  letter-spacing: 0.01em;
}

.onboarding-sub {
  color: var(--ink-2);
  font-size: 14px;
  line-height: 1.55;
  margin: 0;
  max-width: 60ch;
}

.onboarding-step-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: 1fr;
  gap: 10px;
}

.onboarding-step {
  display: grid;
  grid-template-columns: 32px 1fr;
  gap: 14px;
  padding: 14px 16px;
  background: var(--surface);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius);
  align-items: flex-start;
}

.onboarding-step-num {
  width: 28px; height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: var(--surface-3);
  color: var(--ink-2);
  font-family: var(--font-mono);
  font-size: 13px;
  font-weight: var(--w-semibold);
  flex: 0 0 auto;
}

.onboarding-step-body {
  min-width: 0;
}

.onboarding-step-title {
  font-size: 14px;
  font-weight: var(--w-semibold);
  color: var(--ink);
  margin-bottom: 4px;
}

.onboarding-step-text {
  color: var(--ink-3);
  font-size: 13px;
  line-height: 1.6;
  margin: 0;
}
.onboarding-step-text code {
  font-family: var(--font-mono);
  color: var(--ink-2);
  background: var(--surface-2);
  padding: 0 4px;
  border-radius: 3px;
}

.onboarding-status {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 14px 16px;
  background: var(--surface-2);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius);
}

.onboarding-status-row {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 13px;
}

.onboarding-status-label {
  width: 80px;
  color: var(--ink-3);
  flex: 0 0 auto;
}

.onboarding-status-value {
  color: var(--ink-2);
  font-family: var(--font-mono);
  font-size: 12px;
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.onboarding-path {
  /* Path strings can be very long; ellipsis is fine. */
  user-select: text;
}

.onboarding-status-tag {
  font-size: 11px;
  font-weight: var(--w-semibold);
  padding: 2px 8px;
  border-radius: 999px;
  font-family: var(--font-sans);
  border: 1px solid transparent;
  flex: 0 0 auto;
}
.onboarding-status-tag.is-pending { color: var(--ink-3); background: var(--surface-3); border-color: var(--border-soft); }
.onboarding-status-tag.is-warn    { color: var(--ink); background: var(--ember); border-color: var(--accent); }
.onboarding-status-tag.is-error   { color: var(--ink); background: oklch(0.32 0.10 25); border-color: var(--loss); }
.onboarding-status-tag.is-ok      { color: var(--win); background: var(--win-soft); border-color: color-mix(in oklch, var(--win), transparent 60%); }

.onboarding-foot {
  display: flex;
  align-items: center;
  gap: 10px;
}

.onboarding-cta {
  display: inline-flex; align-items: center; gap: 6px;
  height: 32px;
  padding: 0 14px;
}

.onboarding-settings {
  display: inline-flex; align-items: center; gap: 6px;
  height: 32px;
  padding: 0 12px;
}

.onboarding-note {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--ink-3);
  margin: 0;
}
.onboarding-note :deep(svg) {
  color: var(--ink-3);
}
</style>
