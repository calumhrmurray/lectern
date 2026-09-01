import { defineConfig, type Plugin } from 'vite';
import { resolve } from 'node:path';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';

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
      const bind = server.config.server.host;
      const handle = createWorkspaceHandler(root, isFile ? target.slice(root.length + 1) : null, (m) => server.config.logger.info(`  lectern: ${m}`), { host: bind === true ? '0.0.0.0' : bind || '127.0.0.1' });
      server.middlewares.use((req, res, next) => {
        void handle(req, res).then((done) => { if (!done) next(); }).catch(next);
      });
      server.config.logger.info(`  lectern: workspace ${root} → http://localhost:${server.config.server.port ?? 5173}/?ws=local`);
    },
  };
}

const pkgVersion = (): string => (JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as { version: string }).version;
/** Short git SHA so a rebuild of the same commit gives a byte-identical Lectern.html; the date when there is no git (npm tarball). */
function buildStamp(): string {
  try { return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); }
  catch { return new Date().toISOString().slice(0, 10); }
}

// Relative base so the build works from the CLI server and from file:// alike.
export default defineConfig({
  define: { __LECTERN_VERSION__: JSON.stringify(pkgVersion()), __LECTERN_BUILD__: JSON.stringify(buildStamp()) },
  base: './',
  plugins: [lecternDevWorkspace()],
  build: { outDir: 'dist', sourcemap: true, target: 'es2022' },
  server: { port: 5173 },
});
