import { expect, test } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { centerOf, currentSlide, drag, goToSlide, mod, serialized } from './helpers';

const FILE = join(process.cwd(), 'test', '.tmp', 'demo', 'plain', 'index.html');

test.describe('plain HTML decks (custom slide driver)', () => {
  test('opens, navigates, edits and saves a non-reveal deck', async ({ page }) => {
    await page.goto('/?ws=local&deck=plain/index.html&test=1');
    await page.waitForFunction(() => (window as unknown as { lectern: { editor: { ready: boolean } } }).lectern.editor.ready);
    await expect(page.locator('.lec-slide-card')).toHaveCount(3);
    const frame = page.frameLocator('.lec-stage-frame');
    // Only the current slide is displayed; the deck's own chrome follows the hash.
    await goToSlide(page, 1);
    await expect(frame.locator('section.slide.active h2')).toHaveText('The driver is twenty lines of script.');
    await expect(frame.locator('#pageno')).toHaveText('2 / 3');
    // Fragments are shown while editing.
    await expect(frame.locator('li.fragment')).toBeVisible();

    // Keyboard navigation goes through the editor, not the deck's script.
    await page.locator('.lec-overlay').focus();
    await page.keyboard.press('PageDown');
    expect(await currentSlide(page)).toEqual({ top: 2, sub: null });
    await page.keyboard.press('PageUp');

    // Click + drag nudges an element (coordinates go through the scaled iframe).
    const h2 = await centerOf(page, 'section.slide.active h2');
    await page.mouse.click(h2.x, h2.y);
    await expect(page.locator('.lec-box.lec-primary')).toBeVisible();
    const box = await page.locator('.lec-box.lec-primary').boundingBox();
    const target = await frame.locator('section.slide.active h2').boundingBox();
    expect(Math.abs(box!.x - target!.x)).toBeLessThan(3);
    expect(Math.abs(box!.width - target!.width)).toBeLessThan(3);
    await drag(page, h2, { x: h2.x + 60, y: h2.y + 20 });

    // Text editing in place, then save: only slide 2 changes in the file.
    const li = await centerOf(page, 'section.slide.active li');
    await page.mouse.dblclick(li.x, li.y);
    await expect(frame.locator('ul[contenteditable="true"]')).toBeVisible();
    await page.keyboard.press('End');
    await page.keyboard.type(' (edited)');
    await page.keyboard.press('Escape');
    const before = readFileSync(FILE, 'utf8');
    await page.keyboard.press(`${mod}+s`);
    await expect(page.locator('.lec-msg')).toHaveText('Saved');
    const after = readFileSync(FILE, 'utf8');
    expect(after).toMatch(/slide<\/b> \(edited\)<\/li>|slide \(edited\)<\/b><\/li>/);
    expect(after).toMatch(/<h2 style="position:relative;left:\d+px;top:\d+px;">The driver is twenty lines of script\.<\/h2>/);
    expect(after.slice(0, after.indexOf('<!-- 2. BULLETS -->'))).toBe(before.slice(0, before.indexOf('<!-- 2. BULLETS -->')));
    expect(after.slice(after.indexOf('<!-- 3. LAST -->'))).toBe(before.slice(before.indexOf('<!-- 3. LAST -->')));
    // No editor state leaks into the file.
    expect(after).not.toContain('lec-');
    expect(after).not.toContain('class="slide active"');
    expect(after).not.toMatch(/display: ?(flex|none) ?!important/);
    const out = await serialized(page);
    expect(out).toBe(after);
    writeFileSync(FILE, before);
  });
});
