import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { MotionPlugin } from '@vueuse/motion';
import { router } from './router';
import { registerAppIcons } from './icons/register.ts';
import App from './App.vue';

// Offline Phosphor subset — must run before any WIcon mounts.
registerAppIcons();

const app = createApp(App);
app.use(createPinia());
app.use(router);
app.use(MotionPlugin);
app.mount('#app');

