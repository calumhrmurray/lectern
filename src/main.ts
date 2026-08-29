import './styles/editor.css';
import { App } from './app/App';

const root = document.getElementById('app');
if (!root) throw new Error('#app missing');
const app = new App(root);
(window as unknown as { lectern: App }).lectern = app;
void app.start();
