import { expect, test } from '@playwright/test';
import { centerOf, drag, goToSlide, mod, openDeck, selectionInfo, serialized } from './helpers';

test.describe('inspector and arrange', () => {
  test('theme classes toggle, fragments, free layout and z-order', async ({ page }) => {
    await openDeck(page);
    await goToSlide(page, 1);
    const h2 = await centerOf(page, 'section.present h2');
    await page.mouse.click(h2.x, h2.y);

    // Theme class chip
    await page.locator('.lec-chip', { hasText: '.tide' }).click();
    let [sel] = await selectionInfo(page);
    expect(await page.evaluate(() => (window as unknown as { lectern: { editor: { primary: Element } } }).lectern.editor.primary.className)).toBe('tide');

    // Fragment with an effect
    await page.locator('.lec-section', { hasText: 'Build' }).locator('input[type=checkbox]').check();
    await page.locator('.lec-section', { hasText: 'Build' }).locator('select').first().selectOption('fade-up');
    let out = await serialized(page);
    expect(out).toContain('<h2 class="tide fragment fade-up">');

    // Detach from layout: becomes absolutely positioned at the same place
    const before = await page.evaluate(() => (window as unknown as { lectern: { editor: { primary: Element; rectOfSrc: (e: Element) => { x: number; y: number; w: number } } } }).lectern.editor.rectOfSrc((window as unknown as { lectern: { editor: { primary: Element } } }).lectern.editor.primary));
    await page.locator('.lec-seg button', { hasText: 'Free' }).click();
    [sel] = await selectionInfo(page);
    expect(sel.style).toMatch(/position:absolute/);
    const after = await page.evaluate(() => (window as unknown as { lectern: { editor: { primary: Element; rectOfSrc: (e: Element) => { x: number; y: number; w: number } } } }).lectern.editor.rectOfSrc((window as unknown as { lectern: { editor: { primary: Element } } }).lectern.editor.primary));
    expect(Math.abs(after.x - before.x)).toBeLessThan(1.5);
    expect(Math.abs(after.y - before.y)).toBeLessThan(1.5);

    // Send to back: the h2 moves before the kicker in the HTML
    await page.keyboard.press(`${mod}+Shift+[`);
    out = await serialized(page);
    expect(out.indexOf('<h2 class="tide fragment fade-up"')).toBeLessThan(out.indexOf('<div class="kicker">Introduction</div>'));

    // Undo all five steps returns the original markup
    for (let i = 0; i < 5; i++) await page.keyboard.press(`${mod}+z`);
    out = await serialized(page);
    expect(out).toContain('<h2>Three things to remember.</h2>');
    expect(out).not.toContain('fade-up');
  });

  test('shapes insert as free objects; a line keeps its geometry when resized', async ({ page }) => {
    await openDeck(page);
    await goToSlide(page, 0);
    await page.evaluate(() => (window as unknown as { lectern: { editor: { insertElement: (t: string) => void } } }).lectern.editor.insertElement('arrow'));
    let [sel] = await selectionInfo(page);
    expect(sel.tag).toBe('svg');
    const handle = await page.locator('.lec-handle.lec-h-e').boundingBox();
    if (!handle) throw new Error('no handle');
    const hc = { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 };
    await drag(page, hc, { x: hc.x + 100, y: hc.y });
    [sel] = await selectionInfo(page);
    const out = await serialized(page);
    const m = /<svg data-shape="arrow" width="(\d+)" height="(\d+)" viewBox="0 0 (\d+) (\d+)"/.exec(out);
    expect(m).not.toBeNull();
    expect(m![1]).toBe(m![3]);
    expect(Number(m![1])).toBeGreaterThan(512); // default width is 40% of 1280
    expect(out).toContain('<polygon');
  });

  test('align to slide and rotate from the inspector', async ({ page }) => {
    await openDeck(page);
    await goToSlide(page, 3);
    const div = await centerOf(page, 'section.present div[style*="background"]');
    await page.mouse.click(div.x, div.y);
    await page.evaluate(() => (window as unknown as { lectern: { editor: { align: (h: string) => void } } }).lectern.editor.align('center'));
    const r = await page.evaluate(() => { const ed = (window as unknown as { lectern: { editor: { primary: Element; rectOfSrc: (e: Element) => { x: number; w: number } } } }).lectern.editor; return ed.rectOfSrc(ed.primary); });
    expect(Math.abs(r.x + r.w / 2 - 640)).toBeLessThan(1.5);
    const rot = page.locator('.lec-section', { hasText: 'Position & size' }).locator('input').nth(4);
    await rot.fill('15');
    await rot.press('Enter');
    const [sel] = await selectionInfo(page);
    expect(sel.style).toContain('transform:rotate(15deg)');
    await expect(page.locator('.lec-box.lec-primary')).toHaveCSS('transform', /matrix/);
  });

  test('image picker lists folder images and inserts a relative src', async ({ page }) => {
    await openDeck(page);
    await goToSlide(page, 0);
    await page.locator('.lec-btn[data-action="image"]').click();
    const cell = page.locator('.lec-img-cell', { hasText: 'figures/plot.svg' });
    await expect(cell).toBeVisible();
    await cell.dblclick();
    await expect(page.locator('.lec-modal')).toHaveCount(0);
    await page.waitForFunction(() => (window as unknown as { lectern: { editor: { selection: () => Element[] } } }).lectern.editor.selection().length === 1);
    const [sel] = await selectionInfo(page);
    expect(sel.tag).toBe('img');
    const out = await serialized(page);
    expect(out).toMatch(/<img src="figures\/plot\.svg" alt="" style="position:absolute;left:\d+px;top:\d+px;width:\d+px;">/);
  });

  test('copy, paste and duplicate cascade; delete removes; select-all', async ({ page }) => {
    await openDeck(page);
    await goToSlide(page, 3);
    const div = await centerOf(page, 'section.present div[style*="background"]');
    await page.mouse.click(div.x, div.y);
    await page.locator('.lec-overlay').focus();
    await page.keyboard.press(`${mod}+c`);
    await page.keyboard.press(`${mod}+v`);
    await page.keyboard.press(`${mod}+v`);
    let out = await serialized(page);
    expect(out.match(/background:#4a7bd0/g)?.length).toBe(3);
    const lefts = Array.from(out.matchAll(/left:(\d+)px;top:(\d+)px;width:300px/g)).map((m) => [Number(m[1]), Number(m[2])]);
    expect(lefts).toHaveLength(3);
    expect(lefts[1]).toEqual([lefts[0][0] + 20, lefts[0][1] + 20]);
    expect(lefts[2]).toEqual([lefts[0][0] + 40, lefts[0][1] + 40]);
    await page.keyboard.press(`${mod}+a`);
    expect((await selectionInfo(page)).length).toBe(5); // h2 + 3 divs + p
    await page.keyboard.press('Delete');
    out = await serialized(page);
    expect(out).toMatch(/<section data-background-color="#0e0c1a">\s*<\/section>/);
  });
});
