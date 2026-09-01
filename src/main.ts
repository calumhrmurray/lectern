import './styles/editor.css';
import { App } from './app/App';

const root = document.getElementById('app');
if (!root) throw new Error('#app missing');
const app = new App(root);
// The App is exposed for the dev console and the end-to-end tests only: a deck's own scripts run
// same-origin and could otherwise drive the editor through it (see README, "Security model").
if (import.meta.env.DEV || new URLSearchParams(location.search).has('test')) {
  (window as unknown as { lectern: App }).lectern = app;
}
void app.start();
