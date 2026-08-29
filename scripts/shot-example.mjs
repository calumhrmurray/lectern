// Screenshots of a bundled example deck at several slides: node scripts/shot-example.mjs <id> <out-prefix> <slide...>
import { spawn } from 'node:child_process';
import { chromium } from '@playwright/test';
const [id, prefix, ...slides] = process.argv.slice(2);
const port = 8796;
const server = spawn('node', ['cli/index.js', 'test/.tmp/demo', '--port', String(port), '--no-open'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));
try {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForFunction(() => window.lectern?.openExample);
  await page.evaluate((id) => window.lectern.openExample(id), id);
  await page.waitForFunction(() => window.lectern?.editor?.ready, null, { timeout: 30000 });
  await page.waitForTimeout(800);
  for (const s of slides) {
    await page.evaluate((i) => window.lectern.editor.goTo({ top: Number(i), sub: null }), s);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${prefix}-${s}.png` });
  }
  console.log('done', id);
  await browser.close();
} finally { server.kill(); }
