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
import { useSettingsStore } from '../stores/settings.ts';
import SettingsModal from '../components/settings/SettingsModal.vue';

const settings = useSettingsStore();
</script>
