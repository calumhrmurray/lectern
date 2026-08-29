// Screenshots for public/tutorial.html, taken on the whale example (in memory): node scripts/shot-tutorial.mjs
import { spawn } from 'node:child_process';
import { chromium } from '@playwright/test';
const port = 8797;
const out = (n) => `public/tutorial/${n}.jpg`;
const server = spawn('node', ['cli/index.js', 'test/.tmp/demo', '--port', String(port), '--no-open'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));
try {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5 });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  const shot = (n, opts = {}) => page.screenshot({ path: out(n), type: 'jpeg', quality: 82, ...opts });
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForFunction(() => window.lectern?.openExample);
  await page.waitForTimeout(400);
  await shot('welcome');
  await page.evaluate(() => window.lectern.openExample('whale-evolution'));
  await page.waitForFunction(() => window.lectern?.editor?.ready, null, { timeout: 30000 });
  await page.waitForTimeout(1000);
  const ed = () => window.lectern.editor;
  const frame = page.frameLocator('.lec-stage-frame');
  // 1. a slide with a figure: select it (click), inspector shows position/size
  await page.evaluate(() => window.lectern.editor.goTo({ top: 2, sub: null }));
  await page.waitForTimeout(500);
  await shot('editor');
  const fig = frame.locator('section.present svg, section.present img').first();
  let box = await fig.boundingBox();
  if (box) {
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(300);
    await shot('select');
    // 2. mid-drag, with snapping guides
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 - 30, box.y + box.height / 2 + 20, { steps: 6 });
    await page.mouse.move(box.x + box.width / 2 - 70, box.y + box.height / 2 + 60, { steps: 10 });
    await page.waitForTimeout(200);
    await shot('drag');
    await page.mouse.up();
    await page.waitForTimeout(200);
    await page.evaluate(() => window.lectern.editor.undo());
    await page.keyboard.press('Escape');
  }
  // 3. text editing
  const li = frame.locator('section.present li, section.present p').first();
  box = await li.boundingBox();
  if (box) {
    await page.mouse.dblclick(box.x + 40, box.y + box.height / 2);
    await page.waitForTimeout(400);
    await shot('text');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
  }
  // 4. a note for AI: N, type
  await page.evaluate(() => window.lectern.editor.goTo({ top: 2, sub: null }));
  await page.waitForTimeout(400);
  await page.keyboard.press('Escape');
  await page.keyboard.press('n');
  await page.waitForTimeout(400);
  await page.keyboard.type('draw a whale here, facing left');
  await page.waitForTimeout(300);
  await shot('note');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  // 5. a done (green) note — the title slide has one
  await page.evaluate(() => window.lectern.editor.goTo({ top: 0, sub: null }));
  await page.waitForTimeout(500);
  await shot('done');
  // 6. new slide: layout picker
  await page.locator('.lec-btn[data-action="newslide"]').click();
  await page.waitForTimeout(400);
  await shot('layouts');
  await page.keyboard.press('Escape');
  console.log('done');
  await browser.close();
} finally { server.kill(); }
