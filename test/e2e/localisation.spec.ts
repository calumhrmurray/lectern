import { expect, test } from '@playwright/test';

/**
 * Runs only in the `chromium-zh` project (browser locale zh-CN). Proves the
 * editor detects Simplified Chinese, that switching is live and remembered, and
 * that neither depends on the English copy the rest of the suite is pinned to.
 */
test('a zh-CN browser opens in Chinese, and can switch to English for good', async ({ page }) => {
  await page.goto('/?test=1'); // no stored locale: detection decides

  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  // The welcome screen offers both languages by their endonym.
  await expect(page.locator('[data-action="lang-zh"]')).toBeVisible();
  await expect(page.locator('[data-action="welcome-demo"]')).toContainText('试试示例');
  // ...and points the tutorial link at the Chinese page.
  await expect(page.locator('[data-action="welcome-tutorial"]')).toHaveAttribute('href', 'tutorial.zh-CN.html');

  // Switching is live — no reload.
  await page.locator('[data-action="lang-en"]').click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('[data-action="welcome-demo"]')).toContainText('Try the demo');
  await expect(page.locator('[data-action="welcome-tutorial"]')).toHaveAttribute('href', 'tutorial.html');

  // And the choice is remembered.
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('[data-action="welcome-demo"]')).toContainText('Try the demo');
});
