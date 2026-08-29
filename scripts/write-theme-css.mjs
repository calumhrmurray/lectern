// Writes a built-in theme's CSS to a file (used to keep example decks in sync with src/deck/themes.ts).
import { writeFileSync } from 'node:fs';
import { createServer } from 'vite';
const [id, out, extra = ''] = process.argv.slice(2);
const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
const mod = await server.ssrLoadModule('/src/deck/themes.ts');
const theme = mod.DECK_THEMES.find((t) => t.id === id);
if (!theme) throw new Error('unknown theme ' + id);
writeFileSync(out, theme.css + '\n' + extra);
await server.close();
console.log('wrote', out);
