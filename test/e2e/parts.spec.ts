import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { centerOf, drag, goToSlide, mod } from './helpers';

const DIR = join(process.cwd(), 'test', '.tmp', 'demo', 'parts');
const read = (p: string) => readFileSync(join(DIR, p), 'utf8');

test('multi-file decks: slides come from part files and save back to them', async ({ page }) => {
  await page.goto('/?ws=local&deck=parts/session.html&test=1');
  await page.waitForFunction(() => (window as unknown as { lectern: { editor: { ready: boolean } } }).lectern.editor.ready);
  await expect(page.locator('.lec-slide-card')).toHaveCount(3);
  const shellBefore = read('session.html');
  const p0Before = read('slides/p0_intro.html');
  const p1Before = read('slides/p1_more.html');

  await goToSlide(page, 2);
  const h2 = await centerOf(page, 'section.present h2');
  await page.mouse.click(h2.x, h2.y);
  await drag(page, h2, { x: h2.x + 80, y: h2.y + 30 });
  await page.keyboard.press(`${mod}+s`);
  await expect(page.locator('.lec-msg')).toHaveText('Saved');

  expect(read('session.html')).toBe(shellBefore);
  expect(read('slides/p0_intro.html')).toBe(p0Before);
  const p1After = read('slides/p1_more.html');
  expect(p1After).not.toBe(p1Before);
  expect(p1After).toContain('<!-- ============ S1.03 · more ============ -->');
  expect(p1After).toMatch(/<h2 style="position:relative;left:\d+px;top:\d+px;">Second part\.<\/h2>/);
});
