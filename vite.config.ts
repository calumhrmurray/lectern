import { defineConfig, type Plugin } from 'vite';
import { resolve } from 'node:path';
import { existsSync, statSync } from 'node:fs';

/**
 * Dev-server plugin: exposes a deck folder through the same API the CLI
 * serves, so `LECTERN_DIR=path/to/deck npm run dev` opens it at
 * http://localhost:5173/?ws=local (defaults to the demo fixture).
 */
function lecternDevWorkspace(): Plugin {
  return {
    name: 'lectern-dev-workspace',
    async configureServer(server) {
      const { createWorkspaceHandler } = await import('./cli/server.js');
      const target = resolve(process.env.LECTERN_DIR ?? 'test/.tmp/demo');
      const isFile = existsSync(target) && statSync(target).isFile();
      const root = isFile ? resolve(target, '..') : target;
      const handle = createWorkspaceHandler(root, isFile ? target.slice(root.length + 1) : null, (m) => server.config.logger.info(`  lectern: ${m}`));
      server.middlewares.use((req, res, next) => {
        void handle(req, res).then((done) => { if (!done) next(); }).catch(next);
      });
      server.config.logger.info(`  lectern: workspace ${root} → http://localhost:${server.config.server.port ?? 5173}/?ws=local`);
    },
  };
}

// Relative base so the built site works both at the root (CLI server) and under
// a sub-path (GitHub Pages: https://user.github.io/lectern/).
export default defineConfig({
  define: { __LECTERN_BUILD__: JSON.stringify(new Date().toISOString().slice(0, 16).replace('T', ' ')) },
  base: './',
  plugins: [lecternDevWorkspace()],
  build: { outDir: 'dist', sourcemap: true, target: 'es2022' },
  server: { port: 5173 },
});
