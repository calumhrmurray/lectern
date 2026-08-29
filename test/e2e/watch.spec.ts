import { expect, test } from '@playwright/test';
import { readFileSync, writeFileSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { goToSlide, openDeck } from './helpers';

const FILE = join(process.cwd(), 'test', '.tmp', 'demo', 'index.html');

test('edits made on disk by another program are picked up automatically', async ({ page }) => {
  await openDeck(page);
  await goToSlide(page, 1);
  const original = readFileSync(FILE, 'utf8');
  try {
    // Someone (an assistant, an editor) changes the file while the editor is open and clean.
    const edited = original.replace('<h2>Three things to remember.</h2>', '<h2>Three things, rewritten elsewhere.</h2>');
    writeFileSync(FILE, edited);
    const future = new Date(Date.now() + 5000);
    utimesSync(FILE, future, future); // make sure the mtime moves even on coarse filesystems
    const frame = page.frameLocator('.lec-stage-frame');
    await expect(frame.locator('section.present h2')).toHaveText('Three things, rewritten elsewhere.', { timeout: 10_000 });
    await expect(page.locator('.lec-status')).toContainText('Slide 2'); // stayed on the same slide
    // With unsaved local edits, a banner asks instead of clobbering.
    await page.evaluate(() => (window as unknown as { lectern: { editor: { addSlide: (h: string) => number } } }).lectern.editor.addSlide('<section><h2>Local</h2></section>'));
    writeFileSync(FILE, edited.replace('rewritten elsewhere', 'rewritten twice'));
    const later = new Date(Date.now() + 10000);
    utimesSync(FILE, later, later);
    await expect(page.locator('.lec-banner')).toBeVisible({ timeout: 10_000 });
    await page.locator('.lec-banner .lec-btn', { hasText: 'Reload from disk' }).click();
    await expect(page.locator('.lec-banner')).toHaveCount(0);
    await expect(page.locator('.lec-slide-card')).toHaveCount(7);
  } finally {
    writeFileSync(FILE, original);
  }
});

test('autosave writes edits to disk without pressing save', async ({ page }) => {
  await openDeck(page);
  const original = readFileSync(FILE, 'utf8');
  try {
    await page.evaluate(() => (window as unknown as { lectern: { setAutosave: (on: boolean) => void } }).lectern.setAutosave(true));
    await goToSlide(page, 1);
    await page.locator('.lec-overlay').focus();
    await page.keyboard.press('n');
    await page.keyboard.type('autosaved note');
    await page.keyboard.press('Escape');
    await expect(page.locator('.lec-status')).toContainText('autosave');
    await expect.poll(() => readFileSync(FILE, 'utf8').includes('>autosaved note</div>'), { timeout: 8000 }).toBe(true);
    await expect(page.locator('.lec-msg')).toContainText('Autosaved');
  } finally {
    writeFileSync(FILE, original);
  }
});
