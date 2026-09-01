import { expect, type FrameLocator, type Page } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const DECK_DIR = join(process.cwd(), 'test', '.tmp', 'demo');

export function readDeck(): string {
  return readFileSync(join(DECK_DIR, 'index.html'), 'utf8');
}

export function writeDeck(text: string): void {
  writeFileSync(join(DECK_DIR, 'index.html'), text);
}

/** Opens the demo deck through the CLI workspace and waits until the editor is ready. */
export async function openDeck(page: Page): Promise<FrameLocator> {
  // Tests share one fixture on disk: keep autosave off unless a test turns it on.
  // Quiet mode is the editor's default, so specs that want the panels ask for them.
  // ?test=1 exposes window.lectern, which production builds otherwise hide.
  await page.addInitScript(() => {
    try {
      localStorage.setItem('lectern:autosave', 'off');
      localStorage.setItem('lectern:quiet', 'off');
      localStorage.setItem('lectern:tips', 'off'); // the tips spec opts back in
    } catch { /* ignore */ }
  });
  await page.goto('/?ws=local&deck=index.html&test=1');
  await expect(page.locator('.lec-welcome')).toBeHidden();
  const frame = page.frameLocator('.lec-stage-frame');
  await expect(frame.locator('.reveal.ready')).toBeVisible();
  await expect(page.locator('.lec-slide-card').first()).toBeVisible();
  // Wait for the editor to report ready.
  await page.waitForFunction(() => (window as unknown as { lectern: { editor: { ready: boolean } } }).lectern.editor.ready);
  return frame;
}

/** Centre of an element inside the stage iframe, in page coordinates. */
export async function centerOf(page: Page, selector: string): Promise<{ x: number; y: number }> {
  const frame = page.frameLocator('.lec-stage-frame');
  const box = await frame.locator(selector).first().boundingBox();
  if (!box) throw new Error(`No box for ${selector}`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

export async function goToSlide(page: Page, top: number, sub: number | null = null): Promise<void> {
  await page.evaluate(([t, s]) => (window as unknown as { lectern: { editor: { goTo: (r: { top: number; sub: number | null }) => void } } }).lectern.editor.goTo({ top: t as number, sub: s as number | null }), [top, sub]);
}

export async function currentSlide(page: Page): Promise<{ top: number; sub: number | null }> {
  return page.evaluate(() => (window as unknown as { lectern: { editor: { current: { top: number; sub: number | null } } } }).lectern.editor.current);
}

/** Serialised deck text as the editor would save it. */
export async function serialized(page: Page): Promise<string> {
  return page.evaluate(() => (window as unknown as { lectern: { editor: { doc: { serialize: () => string } } } }).lectern.editor.doc.serialize());
}

export async function selectionInfo(page: Page): Promise<{ tag: string; style: string }[]> {
  return page.evaluate(() => (window as unknown as { lectern: { editor: { selection: () => Element[] } } }).lectern.editor.selection().map((e) => ({ tag: e.tagName.toLowerCase(), style: e.getAttribute('style') ?? '' })));
}

export async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, steps = 12): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
  }
  await page.mouse.up();
}

export const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
