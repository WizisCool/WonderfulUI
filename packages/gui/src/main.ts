import { renderApp } from './app.ts';

const root = document.getElementById('app');
if (!root) throw new Error('#app root not found');
renderApp(root);
