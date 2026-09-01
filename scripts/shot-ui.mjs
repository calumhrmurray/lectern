// Screenshots of UI states (welcome, layout picker, text editing) for a visual check.
import { spawn } from 'node:child_process';
import { chromium } from '@playwright/test';
const port = 8798;
const server = spawn('node', ['cli/index.js', 'test/.tmp/demo', '--port', String(port), '--no-open'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));
try {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'test/.shots/ui-welcome.png' });
  await page.goto(`http://127.0.0.1:${port}/?ws=local&test=1&deck=index.html`);
  await page.waitForFunction(() => window.lectern?.editor?.ready);
  await page.waitForTimeout(600);
  await page.locator('.lec-btn[data-action="newslide"]').click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'test/.shots/ui-layouts.png' });
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.lectern.editor.goTo({ top: 1, sub: null }));
  const frame = page.frameLocator('.lec-stage-frame');
  const box = await frame.locator('section.present li').first().boundingBox();
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'test/.shots/ui-textedit.png' });
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.lectern.editor.goTo({ top: 4, sub: null }));
  await page.waitForTimeout(500);
  await page.locator('.lec-btn[data-action="code"]').click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'test/.shots/ui-code.png' });
  await browser.close();
  console.log('done');
} finally { server.kill(); }
