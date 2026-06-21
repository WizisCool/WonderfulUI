<template>
  <Teleport to="body">
    <div v-if="settings.isOpen" class="settings-modal-backdrop" :class="{ 'is-closing': settings.isClosing }">
      <section
        class="settings-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        :data-settings-tab="settings.activeTab"
      >
        <SettingsModal />
      </section>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useSettingsStore } from '../stores/settings.ts';
import SettingsModal from '../components/settings/SettingsModal.vue';

const route = useRoute();
const router = useRouter();
const settings = useSettingsStore();

watch(() => route.name, (name) => {
  if (name === 'settings') {
    settings.setOpen(true);
  } else if (settings.isOpen) {
    settings.setOpen(false);
  }
});

watch(() => settings.isOpen, (open) => {
  if (!open && route.name === 'settings') {
    router.push({ name: 'home' });
  }
});
</script>

<style scoped>
.settings-modal-root[hidden] { display: none; }
.settings-modal-backdrop {
  position: fixed; inset: 0;
  z-index: 1300;
  display: flex; align-items: center; justify-content: center;
  padding: 24px;
  background: oklch(0 0 0 / 0.66);
  animation: settings-backdrop-in 150ms ease-out both;
}
.settings-modal-backdrop.is-closing {
  animation: settings-backdrop-out 120ms ease-in both;
}
.settings-modal {
  width: 720px;
  height: min(620px, calc(100vh - 40px));
  max-width: calc(100vw - 32px);
  max-height: calc(100vh - 40px);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  display: flex; flex-direction: column;
  overflow: hidden;
  animation: settings-modal-in 170ms cubic-bezier(0.16, 1, 0.3, 1) both;
  transform-origin: 50% 48%;
}
.settings-modal-backdrop.is-closing .settings-modal {
  animation: settings-modal-out 120ms ease-in both;
}

@keyframes settings-backdrop-in {
  from { opacity: 0; }
  to   { opacity: 1; }
}
@keyframes settings-backdrop-out {
  from { opacity: 1; }
  to   { opacity: 0; }
}
@keyframes settings-modal-in {
  from { opacity: 0; transform: translateY(8px) scale(0.985); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
}
@keyframes settings-modal-out {
  from { opacity: 1; transform: translateY(0) scale(1); }
  to   { opacity: 0; transform: translateY(4px) scale(0.99); }
}

@media (prefers-reduced-motion: reduce) {
  .settings-modal-backdrop,
  .settings-modal-backdrop.is-closing,
  .settings-modal,
  .settings-modal-backdrop.is-closing .settings-modal {
    animation-duration: 1ms;
  }
}

@media (max-width: 760px) {
  .settings-modal-backdrop { padding: 12px; }
  .settings-modal {
    width: calc(100vw - 24px);
    max-height: calc(100vh - 24px);
  }
}
</style>
