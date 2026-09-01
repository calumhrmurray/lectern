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
  test('is where the editor opens, without being asked', async ({ page }) => {
    // No openDeck() here: that helper turns quiet off so the other specs can see the panels.
    await page.goto('/?ws=local&deck=index.html&test=1');
    await page.waitForFunction(() => window.lectern?.editor?.ready, null, { timeout: 20000 });
    await expect(page.locator('.lec-toolbar')).toBeHidden();
    await expect(page.locator('.lec-quietbar')).toBeVisible();
    await expect(page.locator('.lec-neighbour:not([hidden])')).toHaveCount(1); // slide 1 has a next only
  });

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

  test('the toolbar button toggles it too', async ({ page }) => {
    await openDeck(page);
    await page.locator('.lec-btn[data-action="quiet"]').click();
    await expect(page.locator('.lec-navigator')).toBeHidden();
    expect(await page.evaluate(() => window.lectern.quiet)).toBe(true);
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

  test('a stack puts its slides above and below, never to the side', async ({ page }) => {
    await openDeck(page);
    await page.evaluate(() => window.lectern.setQuiet(true));
    // The fixture's stack is slide 6 (index 5) with two sub-slides.
    await goToSlide(page, 5, 0);
    await expect(page.locator('.lec-neighbour.lec-down:not([hidden])')).toHaveCount(1);
    await expect(page.locator('.lec-neighbour.lec-up:not([hidden])')).toHaveCount(0); // nothing above the first
    await goToSlide(page, 5, 1);
    await expect(page.locator('.lec-neighbour.lec-up:not([hidden])')).toHaveCount(1);
    await expect(page.locator('.lec-neighbour.lec-down:not([hidden])')).toHaveCount(0); // nor below the last
    const g = await page.evaluate(() => {
      const b = window.lectern.editor.slideBoxOnPage();
      const box = (s) => { const el = document.querySelector(`.lec-neighbour.lec-${s}`); if (el.hidden) return null; const r = el.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom }; };
      return { slide: { l: b.left, r: b.left + b.width, t: b.top, b: b.top + b.height }, up: box('up'), next: box('next'), prev: box('prev') };
    });
    expect(g.up.b).toBeLessThanOrEqual(g.slide.t);      // the one you reach with ↑ is above
    expect(g.prev.r).toBeLessThanOrEqual(g.slide.l);    // the one you reach with ← is beside
    expect(g.next).toBeNull();                          // the stack is the last slide of the fixture
  });

  test('the peek below goes down the stack, not along the deck', async ({ page }) => {
    await openDeck(page);
    await page.evaluate(() => window.lectern.setQuiet(true));
    await goToSlide(page, 5, 0);
    await page.locator('.lec-neighbour.lec-down').click();
    expect(await currentSlide(page)).toEqual({ top: 5, sub: 1 });
  });

  test('the glyphs open the map and start the presentation', async ({ page }) => {
    await openDeck(page);
    await page.locator('.lec-glyph[data-action="glyph-map"]').click();
    await expect(page.locator('.lec-map')).toBeVisible();
    await page.locator('.lec-btn[data-action="map-close"]').click();
    await expect(page.locator('.lec-glyph[data-action="glyph-present"]')).toBeVisible();
  });
});

test.describe('tips', () => {
  // No openDeck(): that helper turns tips off, and these are about a first visit.
  const open = async (page) => {
    await page.goto('/?ws=local&deck=index.html&test=1');
    await page.waitForFunction(() => window.lectern?.editor?.ready, null, { timeout: 20000 });
  };

  test('the first thing it says is how to leave a note', async ({ page }) => {
    await open(page);
    await expect(page.locator('.lec-tip')).toBeVisible();
    await expect(page.locator('.lec-tip')).toContainText('Double-click (or right-click) anywhere on the slide');
    await expect(page.locator('.lec-tip')).toContainText('assistant');
    await page.locator('.lec-tip-x').click();
    // then, and only then, where the panels went
    await expect(page.locator('.lec-tip')).toContainText('Q brings them back');
    await page.locator('.lec-tip-x').click();
    await expect(page.locator('.lec-tip')).toHaveCount(0);
  });

  test('each one is said once, and remembered next time', async ({ page }) => {
    await open(page);
    await expect(page.locator('.lec-tip')).toBeVisible();
    await page.locator('.lec-tip-x').click();
    await page.locator('.lec-tip-x').click();
    expect(await page.evaluate(() => localStorage.getItem('lectern:tips:seen'))).toContain('note');
    await page.reload();
    await page.waitForFunction(() => window.lectern?.editor?.ready, null, { timeout: 20000 });
    await page.waitForTimeout(3200); // past the delay that lets the opening toast clear
    await expect(page.locator('.lec-tip')).toHaveCount(0);
  });

  test('the panelled view says nothing: everything there is labelled', async ({ page }) => {
    await open(page);
    await page.locator('.lec-tip-x').click();
    await page.locator('.lec-tip-x').click();
    await page.evaluate(() => { localStorage.removeItem('lectern:tips:seen'); window.lectern.setQuiet(false); });
    await page.evaluate(() => window.lectern.editor.selectAll());
    await page.waitForTimeout(400);
    await expect(page.locator('.lec-tip')).toHaveCount(0);
  });
});

test.describe('the light and the dark room', () => {
  test('a click on the background switches, and switches back', async ({ page }) => {
    await openDeck(page);
    const isDark = () => page.evaluate(() => document.documentElement.classList.contains('lec-dark'));
    expect(await isDark()).toBe(false); // off-white by default
    const above = await page.evaluate(() => {
      const b = window.lectern.editor.slideBoxOnPage();
      return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top - 12) };
    });
    await page.mouse.click(above.x, above.y);
    expect(await isDark()).toBe(true);
    await page.mouse.click(above.x, above.y);
    expect(await isDark()).toBe(false);
  });

  test('the canvas is all one colour, and the deck colour stays on the slide', async ({ page }) => {
    await openDeck(page);
    const sample = () => page.evaluate(() => {
      const d = (document.querySelector('.lec-stage-frame') as HTMLIFrameElement).contentDocument!;
      const bg = d.querySelector('.reveal .backgrounds')!.getBoundingClientRect();
      const slides = d.querySelector('.reveal .slides')!.getBoundingClientRect();
      return {
        room: getComputedStyle(document.body).backgroundColor,
        insideTheFrame: getComputedStyle(d.documentElement).backgroundColor,
        // reveal paints a slide's background across its whole viewport; in the
        // editor that must be pinned to the slide or it floods the canvas.
        pinnedToSlide: Math.abs(bg.width - slides.width) < 2 && Math.abs(bg.height - slides.height) < 2,
      };
    });
    let s = await sample();
    expect(s.insideTheFrame).toBe(s.room);
    expect(s.pinnedToSlide).toBe(true);
    await page.evaluate(() => window.lectern.setDark(true));
    s = await sample();
    expect(s.insideTheFrame).toBe(s.room); // and it follows the room you switch to
  });

  test('a click on the slide itself does not switch', async ({ page }) => {
    await openDeck(page);
    const on = await page.evaluate(() => {
      const b = window.lectern.editor.slideBoxOnPage();
      return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) };
    });
    await page.mouse.click(on.x, on.y);
    expect(await page.evaluate(() => document.documentElement.classList.contains('lec-dark'))).toBe(false);
  });
});

test.describe('the bar', () => {
  test('stays put in every view, including over the map', async ({ page }) => {
    await openDeck(page);
    await expect(page.locator('.lec-quietbar')).toBeVisible(); // panelled view
    await page.locator('.lec-btn[data-action="map"]').click();
    await expect(page.locator('.lec-map')).toBeVisible();
    await expect(page.locator('.lec-quietbar')).toBeVisible();
    await expect(page.locator('.lec-tools')).toBeVisible();
    // and it is genuinely on top of the overlay, not painted under it
    expect(await page.evaluate(() => {
      const r = document.querySelector('.lec-quietbar').getBoundingClientRect();
      const el = document.elementFromPoint(r.left + 12, r.top + r.height / 2);
      return !!el?.closest('.lec-quietbar');
    })).toBe(true);
  });

  test('the compass is top left, the page counter bottom right', async ({ page }) => {
    await openDeck(page);
    await goToSlide(page, 2);
    await expect(page.locator('.lec-compass-num')).toHaveText('3/6');
    expect(await page.evaluate(() => {
      const num = document.querySelector('.lec-compass-num').getBoundingClientRect();
      const dots = document.querySelector('.lec-compass-svg').getBoundingClientRect();
      return {
        numRight: num.left > window.innerWidth / 2, numLow: num.top > window.innerHeight / 2,
        dotsLeft: dots.left < window.innerWidth / 2, dotsHigh: dots.top < window.innerHeight / 2,
      };
    })).toEqual({ numRight: true, numLow: true, dotsLeft: true, dotsHigh: true });
  });

  test('a neighbour is a sliver at the edge, not a panel beside the slide', async ({ page }) => {
    await openDeck(page);
    await page.evaluate(() => window.lectern.setQuiet(true));
    await goToSlide(page, 2);
    const m = await page.evaluate(() => {
      const b = window.lectern.editor.slideBoxOnPage();
      const w = (s) => document.querySelector(`.lec-neighbour.lec-${s}`).getBoundingClientRect().width;
      return { slide: b.width, prev: w('prev'), next: w('next') };
    });
    // A peek is a hint: a small fraction of a slide, never a slab of one.
    expect(m.prev).toBeLessThan(m.slide * 0.2);
    expect(m.next).toBeLessThan(m.slide * 0.2);
    expect(m.prev).toBeGreaterThan(30);
  });

  test('the tools button says when a note is waiting', async ({ page }) => {
    await openDeck(page);
    await expect(page.locator('.lec-tools-dot')).not.toHaveClass(/lec-on/);
    await page.evaluate(() => window.lectern.editor.insertElement('ainote', { edit: false }));
    await expect(page.locator('.lec-tools-dot')).toHaveClass(/lec-on/);
    await expect(page.locator('.lec-tools-btn')).toHaveAttribute('title', /1 note waiting/);
  });

  test('the glyphs and the tools button sit together, bottom left', async ({ page }) => {
    await openDeck(page);
    expect(await page.evaluate(() => {
      const bar = document.querySelector('.lec-quietbar')!.getBoundingClientRect();
      const tools = document.querySelector('.lec-tools-btn')!.getBoundingClientRect();
      const icon = document.querySelector('.lec-glyph .lec-icon')!.getBoundingClientRect();
      return {
        toolsInBar: !!document.querySelector('.lec-quietbar .lec-tools-btn'),
        barLeft: bar.left < window.innerWidth / 2, barLow: bar.top > window.innerHeight / 2,
        toolsAfterGlyphs: tools.left > document.querySelector('.lec-glyph')!.getBoundingClientRect().left,
        iconSize: Math.round(icon.width),
      };
    })).toEqual({ toolsInBar: true, barLeft: true, barLow: true, toolsAfterGlyphs: true, iconSize: 26 });
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

test.describe('opening', () => {
  test('the canvas takes the keyboard without wearing a focus ring', async ({ page }) => {
    await page.goto('/?ws=local&deck=index.html&test=1');
    await page.waitForFunction(() => window.lectern?.editor?.ready, null, { timeout: 20000 });

    // Focused, so the arrow keys work straight away...
    const ring = () => page.evaluate(() => {
      const el = document.querySelector('.lec-overlay') as HTMLElement;
      return { focused: document.activeElement === el, outline: getComputedStyle(el).outlineStyle };
    });
    expect(await ring()).toEqual({ focused: true, outline: 'none' });

    // ...but the ring belongs to the keyboard: once someone uses it, it comes back.
    await page.keyboard.press('ArrowRight');
    expect(await ring()).toEqual({ focused: true, outline: 'solid' });
  });
});
