import type { App } from '../../src/app/App';

declare global {
  interface Window {
    /** The editor exposes itself for tests and for the console (src/main.ts). */
    lectern: App;
  }
}

export {};
