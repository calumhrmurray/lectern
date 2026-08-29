import { expect, test } from '@playwright/test';

test.describe('bundled example decks', () => {
  for (const [id, count] of [['whale-evolution', 20], ['naturalisation-fr', 17]] as const) {
    test(`${id} opens from the welcome screen`, async ({ page }) => {
      await page.goto('/');
      await page.locator('.lec-list-item', { hasText: id === 'whale-evolution' ? 'From land to sea' : 'naturalisation' }).locator('.lec-btn', { hasText: 'Preview' }).click();
      await page.waitForFunction(() => (window as unknown as { lectern: { editor: { ready: boolean } } }).lectern.editor.ready, null, { timeout: 30_000 });
      await expect(page.locator('.lec-slide-card')).toHaveCount(count);
      const frame = page.frameLocator('.lec-stage-frame');
      await expect(frame.locator('section.present h1')).toBeVisible();
      // theme classes discovered from the example's stylesheet
      const classes = await page.evaluate(() => (window as unknown as { lectern: { themeClasses: unknown[] } }).lectern.themeClasses.length);
      expect(classes).toBeGreaterThan(10);
    });
  }

  test('new deck offers the built-in themes', async ({ page }) => {
    await page.goto('/');
    await page.locator('.lec-welcome-actions .lec-btn', { hasText: 'New deck' }).click();
    await expect(page.locator('.lec-theme-card')).toHaveCount(4);
    await expect(page.locator('.lec-theme-card', { hasText: 'Aquarelle' })).toBeVisible();
    await page.keyboard.press('Escape');
  });
});
