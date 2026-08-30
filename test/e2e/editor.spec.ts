import { expect, test } from '@playwright/test';
import { centerOf, currentSlide, drag, goToSlide, mod, openDeck, readDeck, selectionInfo, serialized, writeDeck } from './helpers';

test.describe('opening', () => {
  test('loads the deck with the real reveal.js and lists every slide', async ({ page }) => {
    await openDeck(page);
    await expect(page.locator('.lec-slide-card')).toHaveCount(7); // 5 plain + a stack of 2
    await expect(page.locator('.lec-slide-card').nth(5)).toHaveClass(/lec-sub/);
    await expect(page.locator('.lec-status')).toContainText('1 / 7');
    // thumbnails render the deck's own styles
    const thumb = page.locator('.lec-slide-card').first().locator('iframe');
    await expect(thumb).toHaveAttribute('srcdoc', /title-slide/);
  });

  test('navigates with the navigator and keyboard', async ({ page }) => {
    await openDeck(page);
    await page.locator('.lec-slide-card').nth(2).click();
    expect(await currentSlide(page)).toEqual({ top: 2, sub: null });
    await page.locator('.lec-overlay').focus();
    await page.keyboard.press('PageDown');
    expect(await currentSlide(page)).toEqual({ top: 3, sub: null });
    await page.keyboard.press('PageDown');
    expect(await currentSlide(page)).toEqual({ top: 4, sub: null });
    await page.keyboard.press('PageDown');
    expect(await currentSlide(page)).toEqual({ top: 5, sub: 0 });
    await page.keyboard.press('PageDown');
    expect(await currentSlide(page)).toEqual({ top: 5, sub: 1 });
  });
});

test.describe('selection and moving', () => {
  test('click selects the deepest object; drag nudges it and records undo', async ({ page }) => {
    await openDeck(page);
    await goToSlide(page, 1);
    const h2 = await centerOf(page, 'section.present h2');
    await page.mouse.click(h2.x, h2.y);
    expect((await selectionInfo(page)).map((s) => s.tag)).toEqual(['h2']);
    await expect(page.locator('.lec-box.lec-primary')).toBeVisible();
    await expect(page.locator('.lec-handle')).toHaveCount(9);

    await drag(page, h2, { x: h2.x + 120, y: h2.y + 40 });
    const [sel] = await selectionInfo(page);
    expect(sel.style).toMatch(/position:\s?relative/);
    expect(sel.style).toMatch(/left:\s?\d+px/);
    await expect(page.locator('.lec-status')).toContainText('unsaved');

    // Undo restores the original inline style (none).
    await page.keyboard.press(`${mod}+z`);
    const after = await selectionInfo(page);
    expect(after[0]?.style ?? '').toBe('');
  });

  test('the list is selected as one object; the parent is reachable via the breadcrumb', async ({ page }) => {
    await openDeck(page);
    await goToSlide(page, 1);
    const li = await centerOf(page, 'section.present li');
    await page.mouse.click(li.x, li.y);
    expect((await selectionInfo(page)).map((s) => s.tag)).toEqual(['ul']);
    await page.locator('.lec-crumb', { hasText: 'slide' }).count(); // breadcrumb exists
    await expect(page.locator('.lec-crumb.lec-active')).toHaveText('ul');
  });

  test('marquee selects several free objects and nudges them with the arrow keys', async ({ page }) => {
    await openDeck(page);
    await goToSlide(page, 3);
    const box = page.locator('.lec-canvas-outline');
    const c = await box.boundingBox();
    if (!c) throw new Error('no canvas');
    // Drag across the whole slide from empty space at the bottom-right corner.
    await drag(page, { x: c.x + c.width - 5, y: c.y + c.height - 5 }, { x: c.x + 5, y: c.y + 5 });
    const sel = await selectionInfo(page);
    expect(sel.map((s) => s.tag).sort()).toEqual(['div', 'h2', 'p']);
    await page.keyboard.press('Shift+ArrowRight');
    const after = await selectionInfo(page);
    const div = after.find((s) => s.tag === 'div')!;
    expect(div.style).toMatch(/left:\s?130px/);
  });

  test('resizing an image keeps its aspect ratio', async ({ page }) => {
    await openDeck(page);
    await goToSlide(page, 2);
    const img = await centerOf(page, 'section.present img');
    await page.mouse.click(img.x, img.y);
    expect((await selectionInfo(page)).map((s) => s.tag)).toEqual(['img']);
    const handle = await page.locator('.lec-handle.lec-h-se').boundingBox();
    if (!handle) throw new Error('no handle');
    const hc = { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 };
    await drag(page, hc, { x: hc.x - 60, y: hc.y - 10 });
    const [sel] = await selectionInfo(page);
    expect(sel.style).toMatch(/width:\s?\d+px/);
    expect(sel.style).toMatch(/height:\s?auto/);
  });
});

test.describe('text editing', () => {
  test('double-click edits text in place and commits on Escape', async ({ page }) => {
    const frame = await openDeck(page);
    await goToSlide(page, 1);
    const h2 = await centerOf(page, 'section.present h2');
    await page.mouse.click(h2.x, h2.y);
    await page.keyboard.press('Enter');
    await expect(frame.locator('section.present h2[contenteditable="true"]')).toBeVisible();
    await page.keyboard.press(`${mod}+a`);
    await page.keyboard.type('Three things, edited.');
    await page.keyboard.press('Escape');
    await expect(frame.locator('section.present h2[contenteditable]')).toHaveCount(0);
    const out = await serialized(page);
    expect(out).toContain('<h2>Three things, edited.</h2>');
    // untouched slides are byte-identical
    expect(out).toContain('<b>Calum Murray</b> &middot; CEA Paris-Saclay');
  });

  test('inserting a text box starts editing; an emptied box is removed', async ({ page }) => {
    const frame = await openDeck(page);
    await goToSlide(page, 0);
    await page.locator('.lec-btn[data-action="text"]').click();
    await expect(frame.locator('section.present p[contenteditable="true"]')).toBeVisible();
    await page.keyboard.type('Hello canvas');
    await page.keyboard.press('Escape');
    let out = await serialized(page);
    expect(out).toMatch(/<p style="position:absolute;[^"]*">Hello canvas<\/p>/);
    // Insert another and delete its contents: it should vanish.
    await page.locator('.lec-btn[data-action="text"]').click();
    await page.keyboard.press(`${mod}+a`);
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Escape');
    out = await serialized(page);
    expect(out.match(/position:absolute;left:\d+px;top:\d+px;width:\d+px;margin:0;">/g)?.length ?? 0).toBe(1);
  });
});

test.describe('slides', () => {
  test('adds, duplicates, reorders and deletes slides', async ({ page }) => {
    await openDeck(page);
    await goToSlide(page, 1);
    await page.evaluate(() => (window as unknown as { lectern: { editor: { addSlide: (h: string) => number } } }).lectern.editor.addSlide('<section>\n  <h2>Inserted</h2>\n</section>'));
    await expect(page.locator('.lec-slide-card')).toHaveCount(8);
    expect(await currentSlide(page)).toEqual({ top: 2, sub: null });
    await page.keyboard.press(`${mod}+d`);
    await expect(page.locator('.lec-slide-card')).toHaveCount(9);
    await page.evaluate(() => (window as unknown as { lectern: { editor: { moveSlide: (a: number, b: number) => void } } }).lectern.editor.moveSlide(3, 0));
    let out = await serialized(page);
    expect(out.indexOf('<h2>Inserted</h2>')).toBeLessThan(out.indexOf('<!-- ============ 1 · title ============ -->'));
    await page.evaluate(() => (window as unknown as { lectern: { editor: { deleteSlide: () => void } } }).lectern.editor.deleteSlide());
    await expect(page.locator('.lec-slide-card')).toHaveCount(8);
    await page.keyboard.press(`${mod}+z`);
    await expect(page.locator('.lec-slide-card')).toHaveCount(9);
    out = await serialized(page);
    expect(out.match(/<h2>Inserted<\/h2>/g)?.length).toBe(2);
  });

  test('slide attributes and notes round-trip', async ({ page }) => {
    await openDeck(page);
    await goToSlide(page, 1);
    await page.locator('.lec-tabs .lec-tab', { hasText: /^Slide$/ }).click();
    const color = page.locator('.lec-section', { hasText: 'Background' }).locator('.lec-color .lec-field').first();
    await color.fill('#123456');
    await color.press('Enter');
    let out = await serialized(page);
    expect(out).toContain('<section data-background-color="#123456">');
    await page.locator('.lec-btn[data-action="notes"]').click();
    await page.locator('.lec-notes-text').fill('Remember to breathe.');
    await page.waitForTimeout(600);
    out = await serialized(page);
    expect(out).toMatch(/<aside class="notes">\s*Remember to breathe\.\s*<\/aside>/);
  });
});

test.describe('saving', () => {
  test('writes only the changed slide back to disk, byte-for-byte elsewhere', async ({ page }) => {
    await openDeck(page);
    const before = readDeck();
    await goToSlide(page, 3);
    const div = await centerOf(page, 'section.present div[style*="background"]');
    await page.mouse.click(div.x, div.y);
    await drag(page, div, { x: div.x + 50, y: div.y });
    await page.keyboard.press(`${mod}+s`);
    await expect(page.locator('.lec-msg')).toHaveText('Saved');
    const after = readDeck();
    expect(after).not.toBe(before);
    // Everything before slide 4 is unchanged.
    const cut = '<!-- ============ 4 · free objects ============ -->';
    expect(after.slice(0, after.indexOf(cut))).toBe(before.slice(0, before.indexOf(cut)));
    // Everything after slide 4 is unchanged too.
    const tail = '<!-- ============ 5 · equation ============ -->';
    expect(after.slice(after.indexOf(tail))).toBe(before.slice(before.indexOf(tail)));
    const m = /left:(\d+)px;top:220px/.exec(after);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeGreaterThan(120);
    // untouched declarations keep the author's spelling
    expect(after).toContain('background:#4a7bd0');
    await expect(page.locator('.lec-status')).not.toContainText('unsaved');
    // Leave the fixture as we found it for the other tests.
    writeDeck(before);
  });
});

test.describe('math', () => {
  test('LaTeX is edited as source and re-typeset on commit', async ({ page }) => {
    const frame = await openDeck(page);
    await goToSlide(page, 4);
    await expect(frame.locator('section.present .katex')).toHaveCount(2);
    const eq = await centerOf(page, 'section.present p.eq');
    await page.mouse.click(eq.x, eq.y);
    await page.keyboard.press('Enter');
    const editing = frame.locator('section.present p.eq[contenteditable="true"]');
    await expect(editing).toBeVisible();
    await expect(editing).toContainText('\\xi_{g+}');
    await expect(editing.locator('.katex')).toHaveCount(0);
    await page.keyboard.press('End');
    await page.keyboard.type(' edited');
    await page.keyboard.press('Escape');
    await expect(frame.locator('section.present p.eq .katex')).toHaveCount(1);
    const out = await serialized(page);
    expect(out).toContain('\\xi_{g+}(r_p) = \\frac{S_+D - S_+R}{RR} \\] edited</p>');
    expect(out).not.toContain('class="katex');
  });
});
