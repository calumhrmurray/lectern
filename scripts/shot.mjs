// Opens a deck folder in the built editor with headless Chromium and saves a
// screenshot — a quick visual smoke test. Usage:
//   node scripts/shot.mjs <folder> <deck.html> <out.png> [slideIndex] [selector-to-click]
import { spawn } from 'node:child_process';
import { chromium } from '@playwright/test';

const [folder, deck, out = 'shot.png', slide = '0', clickSel = ''] = process.argv.slice(2);
if (!folder || !deck) { console.error('usage: node scripts/shot.mjs <folder> <deck.html> <out.png> [slide] [selector]'); process.exit(1); }
const port = 8799;
const server = spawn('node', ['cli/index.js', folder, '--port', String(port), '--no-open'], { stdio: 'inherit' });
await new Promise((r) => setTimeout(r, 800));
try {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('[console]', m.type(), m.text()); });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto(`http://127.0.0.1:${port}/?ws=local&test=1&deck=${encodeURIComponent(deck)}`);
  await page.waitForFunction(() => window.lectern?.editor?.ready, null, { timeout: 30000 }).catch((e) => console.log('not ready:', e.message));
  await page.waitForTimeout(800);
  await page.evaluate((i) => window.lectern.editor.goTo({ top: Number(i), sub: null }), slide);
  await page.waitForTimeout(600);
  if (clickSel) {
    const frame = page.frameLocator('.lec-stage-frame');
    const box = await frame.locator(clickSel).first().boundingBox();
    if (box) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(300);
  }
  await page.screenshot({ path: out });
  const info = await page.evaluate(() => ({ slides: window.lectern.editor.slideRefs().length, classes: window.lectern.themeClasses.length, fonts: window.lectern.fonts.length, math: window.lectern.editor.stage.hasMath }));
  console.log('screenshot →', out, info);
  await browser.close();
} finally {
  server.kill();
}
