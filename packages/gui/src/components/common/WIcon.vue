<template>
  <Icon
    class="w-icon"
    :icon="icon"
    :width="size"
    :height="size"
    aria-hidden="true"
  />
</template>

<script setup lang="ts">
import { Icon } from '@iconify/vue';

withDefaults(defineProps<{ icon: string; size?: number }>(), { size: 16 });
</script>

<style scoped>
.w-icon {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  line-height: 0;
  color: inherit;
  vertical-align: middle;
}
/* Ensure SVG paints with the parent's text color (ctrl-btn / brand icon). */
.w-icon :deep(svg) {
  display: block;
  color: inherit;
  fill: currentColor;
}
</style>
