import { createRouter, createMemoryHistory } from 'vue-router';
import type { RouteRecordRaw } from 'vue-router';
import HomeView from '../views/HomeView.vue';
import SettingsView from '../views/SettingsView.vue';

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'home',
    component: HomeView,
  },
  {
    path: '/match/:id',
    name: 'detail',
    component: HomeView,
    props: true,
  },
  {
    path: '/settings',
    name: 'settings',
    component: SettingsView,
  },
];

export const router = createRouter({
  history: createMemoryHistory(),
  routes,
});
