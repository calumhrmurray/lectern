// Bundles the DOM-free deck templates (src/deck/templates.ts + themes.ts + html.ts)
// into dist/lib/templates.js so the `lectern new` CLI command can scaffold a deck
// from plain node without the browser build. Run as part of `npm run build`.
import { build } from 'esbuild';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
await build({
  stdin: {
    contents: "export * from './src/deck/templates'; export { DECK_THEMES, themeById } from './src/deck/themes';",
    resolveDir: root,
    loader: 'ts',
  },
  outfile: join(root, 'dist', 'lib', 'templates.js'),
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  target: 'es2022',
  minify: false,
  logLevel: 'warning',
});
console.log('built dist/lib/templates.js');

// The markdown converter for `lectern convert`, with parse5 bundled in so the
// published package still has no runtime dependencies.
await build({
  stdin: {
    contents: "export * from './src/deck/markdown'; export { parseHtml } from './src/deck/markdownParse5';",
    resolveDir: root,
    loader: 'ts',
  },
  outfile: join(root, 'dist', 'lib', 'markdown.js'),
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  target: 'es2022',
  minify: false,
  logLevel: 'warning',
});
console.log('built dist/lib/markdown.js');
