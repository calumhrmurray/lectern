import { expect, test } from '@playwright/test';
import { currentSlide, goToSlide, openDeck, serialized } from './helpers';

/** The demo fixture: 6 top-level slides, one of which is a stack of 2 (7 refs). */

test.describe('compass', () => {
  test('draws one dot per slide, a descender for the stack, and the position', async ({ page }) => {
    await openDeck(page);
    await expect(page.locator('.lec-compass-dot')).toHaveCount(6);
    // The stack is the only slide with sub-dots hanging under it.
    await expect(page.locator('.lec-compass-sub')).toHaveCount(2);
    await expect(page.locator('.lec-compass-num')).toHaveText('1/6');
    await goToSlide(page, 5, 1);
    await expect(page.locator('.lec-compass-num')).toHaveText('6.2/6');
  });

  test('a dot navigates, and stays right after the deck changes', async ({ page }) => {
    await openDeck(page);
    await page.locator('.lec-compass-hit').nth(2).click();
    expect(await currentSlide(page)).toEqual({ top: 2, sub: null });
    await page.evaluate(() => window.lectern.editor.deleteSlide({ top: 0, sub: null }));
    await expect(page.locator('.lec-compass-dot')).toHaveCount(5);
  });
});

test.describe('quiet mode', () => {
  test('Q hides the panels and keeps the compass; space brings them back', async ({ page }) => {
    await openDeck(page);
    await expect(page.locator('.lec-toolbar')).toBeVisible();
    await page.locator('.lec-overlay').focus();
    await page.keyboard.press('q');
    await expect(page.locator('.lec-toolbar')).toBeHidden();
    await expect(page.locator('.lec-navigator')).toBeHidden();
    await expect(page.locator('.lec-inspector')).toBeHidden();
    await expect(page.locator('.lec-compass')).toBeVisible();
    await expect(page.locator('.lec-quietbar')).toBeVisible();
    await expect(page.locator('.lec-tools')).toBeVisible();

    await page.keyboard.down(' ');
    await expect(page.locator('.lec-toolbar')).toBeVisible();
    await page.keyboard.up(' ');
    await expect(page.locator('.lec-toolbar')).toBeHidden();

    await page.keyboard.press('q');
    await expect(page.locator('.lec-toolbar')).toBeVisible();
  });

  test('the toolbar button toggles it too, and it is remembered', async ({ page }) => {
    await openDeck(page);
    await page.locator('.lec-btn[data-action="quiet"]').click();
    await expect(page.locator('.lec-navigator')).toBeHidden();
    expect(await page.evaluate(() => localStorage.getItem('lectern:quiet'))).toBe('on');
    await page.locator('.lec-tools-btn').click();
    await page.locator('.lec-tools-item[data-action="tool-more"]').click();
    await page.getByText('Show the panels').click();
    await expect(page.locator('.lec-navigator')).toBeVisible();
  });
});

test.describe('the slides either side', () => {
  test('appear in the gutters in quiet mode, and navigate', async ({ page }) => {
    await openDeck(page);
    await expect(page.locator('.lec-neighbour:not([hidden])')).toHaveCount(0);
    await page.evaluate(() => window.lectern.setQuiet(true));
    await goToSlide(page, 2);
    await expect(page.locator('.lec-neighbour:not([hidden])')).toHaveCount(2);
    await page.locator('.lec-neighbour.lec-next').click();
    expect(await currentSlide(page)).toEqual({ top: 3, sub: null });
  });

  test('only one of them at the ends of the deck, and none of them overlaps the slide', async ({ page }) => {
    await openDeck(page);
    await page.evaluate(() => window.lectern.setQuiet(true));
    await goToSlide(page, 0);
    await expect(page.locator('.lec-neighbour:not([hidden])')).toHaveCount(1);
    await goToSlide(page, 2);
    const boxes = await page.evaluate(() => {
      const slide = window.lectern.editor.stage.canvasClientRect();
      const fr = window.lectern.editor.stage.iframe.getBoundingClientRect();
      const left = fr.left + slide.left;
      const right = left + slide.width;
      const sides = [...document.querySelectorAll('.lec-neighbour:not([hidden])')].map((el) => {
        const r = el.getBoundingClientRect();
        return { left: r.left, right: r.right, top: Math.round(r.top), height: Math.round(r.height) };
      });
      return { left, right, slideTop: Math.round(fr.top + slide.top), slideHeight: Math.round(slide.height), sides };
    });
    for (const s of boxes.sides) {
      expect(s.right <= boxes.left || s.left >= boxes.right).toBe(true); // never over the slide
      expect(s.top).toBe(boxes.slideTop); // and lined up with it
      expect(s.height).toBe(boxes.slideHeight);
    }
  });

  test('the glyphs open the map and start the presentation', async ({ page }) => {
    await openDeck(page);
    await page.locator('.lec-glyph[data-action="glyph-map"]').click();
    await expect(page.locator('.lec-map')).toBeVisible();
    await page.locator('.lec-btn[data-action="map-close"]').click();
    await expect(page.locator('.lec-glyph[data-action="glyph-present"]')).toBeVisible();
  });
});

test.describe('map', () => {
  test('M opens a column per slide, with the stack drawn downward', async ({ page }) => {
    await openDeck(page);
    await page.locator('.lec-overlay').focus();
    await page.keyboard.press('m');
    await expect(page.locator('.lec-map')).toBeVisible();
    await expect(page.locator('.lec-map-col')).toHaveCount(7); // 6 slides + the trailing add column
    await expect(page.locator('.lec-map-card')).toHaveCount(7);
    await expect(page.locator('.lec-map-down')).toHaveCount(1); // one arrow inside the stack of 2
    await expect(page.locator('.lec-map-count')).toContainText('7 slides');
  });

  test('a card goes to its slide and closes the map', async ({ page }) => {
    await openDeck(page);
    await page.locator('.lec-btn[data-action="map"]').click();
    await page.locator('.lec-map-card').nth(3).click();
    expect(await currentSlide(page)).toEqual({ top: 3, sub: null });
    await expect(page.locator('.lec-map')).toBeHidden();
  });

  test('Escape closes it', async ({ page }) => {
    await openDeck(page);
    await page.locator('.lec-overlay').focus();
    await page.keyboard.press('m');
    await expect(page.locator('.lec-map')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.lec-map')).toBeHidden();
  });

  test('naming a section writes data-section and labels the column', async ({ page }) => {
    await openDeck(page);
    await page.locator('.lec-btn[data-action="map"]').click();
    await page.locator('.lec-map-col').nth(2).locator('.lec-map-sec').click();
    await page.locator('.lec-modal-backdrop input.lec-field').fill('Anatomy');
    await page.locator('.lec-modal-foot .lec-primary').click();
    await expect(page.locator('.lec-map-col').nth(2).locator('.lec-map-sec')).toHaveText('Anatomy');
    expect(await serialized(page)).toContain('data-section="Anatomy"');
    // The compass shows the name of the section you are standing in.
    await page.locator('.lec-map-card').nth(2).click();
    await expect(page.locator('.lec-compass-section')).toHaveText('Anatomy');
  });
});

test.describe('adding slides from the map', () => {
  test('a new slide is titled before it exists', async ({ page }) => {
    await openDeck(page);
    await page.locator('.lec-btn[data-action="map"]').click();
    await page.locator('.lec-map-col').first().locator('[data-action="map-add-after"]').click();
    await page.locator('.lec-modal-backdrop input.lec-field').fill('Second thoughts');
    await page.locator('.lec-modal-foot .lec-primary').click();
    await expect(page.locator('.lec-map-col')).toHaveCount(8); // 7 slides + the trailing add column
    expect(await serialized(page)).toContain('<h2>Second thoughts</h2>');
    await expect(page.locator('.lec-map-card').nth(1).locator('.lec-map-cardlabel')).toHaveText('Second thoughts');
    expect(await currentSlide(page)).toEqual({ top: 1, sub: null });
  });

  test('a new slide below makes a stack', async ({ page }) => {
    await openDeck(page);
    await page.locator('.lec-btn[data-action="map"]').click();
    await page.locator('.lec-map-col').first().locator('[data-action="map-add-sub"]').click();
    await page.locator('.lec-modal-backdrop input.lec-field').fill('The detail');
    await page.locator('.lec-modal-foot .lec-primary').click();
    expect(await page.evaluate(() => window.lectern.editor.doc.length)).toBe(6);
    expect(await page.evaluate(() => window.lectern.editor.slideRefs().filter((r) => r.top === 0).length)).toBe(2);
    await expect(page.locator('.lec-map-down')).toHaveCount(2); // the fixture's stack, and this one
  });

  test('a title can be changed from the card label', async ({ page }) => {
    await openDeck(page);
    await page.locator('.lec-btn[data-action="map"]').click();
    await page.locator('.lec-map-card').nth(1).locator('.lec-map-cardlabel').click();
    await page.locator('.lec-modal-backdrop input.lec-field').fill('A better heading');
    await page.locator('.lec-modal-foot .lec-primary').click();
    expect(await serialized(page)).toContain('A better heading');
    await expect(page.locator('.lec-map-card').nth(1).locator('.lec-map-cardlabel')).toHaveText('A better heading');
  });
});

test.describe('the second axis', () => {
  test('nesting makes a stack, and undo puts it back', async ({ page }) => {
    await openDeck(page);
    const before = await serialized(page);
    await page.evaluate(() => window.lectern.editor.nestSlide(2, 1));
    expect(await page.evaluate(() => window.lectern.editor.doc.length)).toBe(5);
    expect(await page.evaluate(() => window.lectern.editor.slideRefs().length)).toBe(7);
    expect(await currentSlide(page)).toEqual({ top: 1, sub: 1 });
    await page.evaluate(() => window.lectern.editor.undo());
    expect(await page.evaluate(() => window.lectern.editor.doc.length)).toBe(6);
    expect(await serialized(page)).toBe(before);
  });

  test('promoting takes a slide back out of its stack', async ({ page }) => {
    await openDeck(page);
    // The fixture's stack is slide 6 (index 5) with two sub-slides.
    await page.evaluate(() => window.lectern.editor.unnestSlide(5, 1));
    expect(await page.evaluate(() => window.lectern.editor.doc.length)).toBe(7);
    // One sub-slide left is no longer a stack: every ref is now a plain slide.
    expect(await page.evaluate(() => window.lectern.editor.slideRefs().every((r) => r.sub === null))).toBe(true);
    expect(await currentSlide(page)).toEqual({ top: 6, sub: null });
  });

  test('a named section survives being turned into a stack', async ({ page }) => {
    await openDeck(page);
    await page.evaluate(() => {
      const ed = window.lectern.editor;
      ed.setSlideAttr({ top: 1, sub: null }, 'data-section', 'Anatomy');
      ed.nestSlide(2, 1);
    });
    const html = await serialized(page);
    expect(html).toContain('data-section="Anatomy"');
    // It belongs to the stack wrapper, not to the slide that is now inside it.
    expect(await page.evaluate(() => window.lectern.editor.doc.slides[1].el.getAttribute('data-section'))).toBe('Anatomy');
    expect(await page.evaluate(() => {
      const stack = window.lectern.editor.doc.slides[1].el;
      return Array.from(stack.children).filter((c) => c.tagName === 'SECTION').some((c) => c.hasAttribute('data-section'));
    })).toBe(false);
  });
});
