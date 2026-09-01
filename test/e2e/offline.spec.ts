import { expect, test, type Page, type Request } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openDeck } from './helpers';

/**
 * Lectern must work with the network unplugged. These tests cut the network at the
 * browser and fail if anything reaches for it — the guarantee is meant to hold by
 * construction, not by the machine happening to be offline when the suite runs.
 */

const LOCAL = /^(https?:\/\/(127\.0\.0\.1|\[::1\]|localhost)(:\d+)?)|^(file|data|blob|about):/;

/** Records every request that leaves the machine, and refuses it. */
function cutTheNetwork(page: Page): string[] {
  const escaped: string[] = [];
  page.on('request', (req: Request) => { if (!LOCAL.test(req.url())) escaped.push(`${req.method()} ${req.url()}`); });
  void page.route('**/*', async (route) => {
    if (LOCAL.test(route.request().url())) await route.continue();
    else await route.abort('blockedbyclient');
  });
  return escaped;
}

test('the editor loads, edits and presents a deck with no network at all', async ({ page }) => {
  const escaped = cutTheNetwork(page);
  const frame = await openDeck(page);

  // The deck renders, including its maths on a later slide (KaTeX is served from
  // the deck folder, so it typesets with the network cut).
  await expect(frame.locator('section.present h1')).toBeVisible();
  await expect(frame.locator('.katex').first()).toBeAttached();

  // An edit round-trips.
  await page.locator('.lec-overlay').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.lec-slide-card.lec-current')).toBeVisible();

  expect(escaped, `these requests tried to leave the machine:\n${escaped.join('\n')}`).toEqual([]);
});

test('the welcome screen and a new deck need no network either', async ({ page }) => {
  const escaped = cutTheNetwork(page);
  await page.goto('/?test=1');
  await expect(page.locator('.lec-welcome')).toBeVisible();
  await page.locator('.lec-welcome-actions .lec-btn', { hasText: 'New deck' }).click();
  await expect(page.locator('.lec-theme-card')).toHaveCount(4);
  await page.keyboard.press('Escape');
  expect(escaped, `these requests tried to leave the machine:\n${escaped.join('\n')}`).toEqual([]);
});

test('a scaffolded deck references nothing outside its own folder', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lectern-offline-'));
  try {
    execFileSync(process.execPath, [join(process.cwd(), 'cli', 'index.js'), 'new', dir, '--title', 'Offline'], { stdio: 'pipe' });
    const html = readFileSync(join(dir, 'index.html'), 'utf8');
    const external = [...html.matchAll(/(?:src|href)="(https?:\/\/[^"]+)"/g)].map((m) => m[1]);
    expect(external, `the scaffold points outside the deck folder: ${external.join(', ')}`).toEqual([]);
    // KaTeX is beside reveal, so maths typesets offline.
    expect(html).toContain("katex: { local: 'reveal/katex' }");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a deck written from Lectern.html typesets maths from its own folder', async ({ page }) => {
  // Lectern.html has no server behind it: it writes the reveal.js and KaTeX it carries
  // (REVEAL_EMBEDDED) beside the deck. Build that folder here and open it over file://.
  const dir = mkdtempSync(join(tmpdir(), 'lectern-file-'));
  try {
    const reveal = join(process.cwd(), 'public', 'reveal');
    const put = (rel: string, from: string) => { mkdirSync(dirname(join(dir, rel)), { recursive: true }); cpSync(from, join(dir, rel)); };
    for (const f of ['dist/reveal.js', 'dist/reveal.css', 'dist/reset.css', 'plugin/math/math.js', 'plugin/notes/notes.js']) {
      put(join('reveal', f), join(reveal, f));
    }
    put('reveal/katex/dist/katex.min.js', join(reveal, 'katex/dist/katex.min.js'));
    put('reveal/katex/dist/contrib/auto-render.min.js', join(reveal, 'katex/dist/contrib/auto-render.min.js'));
    // The embedded stylesheet carries its fonts, because there is no folder to serve them from.
    put('reveal/katex/dist/katex.min.css', join(process.cwd(), '.build', 'katex.embedded.css'));
    execFileSync(process.execPath, [join(process.cwd(), 'cli', 'index.js'), 'new', dir, '--title', 'Maths', '--no-reveal', '--force'], { stdio: 'pipe' });
    // --no-reveal kept the copy above; point the deck back at it and give it a formula.
    const deck = join(dir, 'index.html');
    writeFileSync(deck, readFileSync(deck, 'utf8')
      .replace(/https:\/\/cdn\.jsdelivr\.net\/npm\/reveal\.js@5/g, 'reveal')
      .replace('<h1>', '<p>\\(e^{i\\pi}+1=0\\)</p><h1>')
      .replace('plugins: [', "katex: { local: 'reveal/katex' },\n      plugins: ["));

    const escaped: string[] = [];
    page.on('request', (req) => { if (!LOCAL.test(req.url())) escaped.push(req.url()); });
    await page.route('**/*', async (route) => {
      if (LOCAL.test(route.request().url())) await route.continue();
      else await route.abort('blockedbyclient');
    });
    await page.goto(pathToFileURL(deck).href);
    await expect(page.locator('.katex').first()).toBeVisible();
    expect(escaped, `these requests tried to leave the machine:\n${escaped.join('\n')}`).toEqual([]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
