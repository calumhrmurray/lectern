import { expect, test } from '@playwright/test';

// The demo deck lives in memory and is served to the canvas by the service
// worker — the same path "Open a folder…" uses with a directory handle.
test('the welcome screen opens the in-memory demo through the service worker', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.lec-welcome h1')).toContainText('Lectern');
  await page.locator('.lec-welcome-actions .lec-btn', { hasText: 'Try the demo' }).click();
  await page.waitForFunction(() => (window as unknown as { lectern: { editor: { ready: boolean } } }).lectern.editor.ready, null, { timeout: 30_000 });
  await expect(page.locator('.lec-welcome')).toBeHidden();
  await expect(page.locator('.lec-slide-card')).toHaveCount(7);
  const frame = page.frameLocator('.lec-stage-frame');
  await expect(frame.locator('.reveal.ready')).toBeVisible();
  // Saving works against the in-memory workspace.
  await page.evaluate(() => (window as unknown as { lectern: { editor: { addSlide: (h: string) => number } } }).lectern.editor.addSlide('<section><h2>Demo edit</h2></section>'));
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+s' : 'Control+s');
  await expect(page.locator('.lec-msg')).toHaveText('Saved');
});
