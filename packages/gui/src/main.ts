import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { MotionPlugin } from '@vueuse/motion';
import { router } from './router';
import App from './App.vue';

const app = createApp(App);
app.use(createPinia());
app.use(router);
app.use(MotionPlugin);
app.mount('#app');
