import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
// @ts-expect-error plain JS module without types
import { notesPrompt, pendingNotes } from '../../cli/notes.js';

const root = resolve(__dirname, '..', '..');
const cli = join(root, 'cli', 'index.js');

const DECK = `<!doctype html><div class="reveal"><div class="slides">
<section><h1>Intro</h1>
  <div hidden data-ai-note="" style="position:absolute;left:640px;top:200px;width:260px;"><p data-by="author">draw a whale here</p><p data-by="ai">Drew a whale.</p><p data-by="author">bigger please</p></div>
</section>
<section><h2>Done</h2>
  <div hidden data-ai-note="done" style="position:absolute;left:10px;top:20px;"><p data-by="author">fix typo</p><p data-by="ai">Fixed.</p></div>
</section>
<section><h2>Legacy</h2>
  <div hidden data-ai-note style="position:absolute;left:1px;top:2px;">plain text note</div>
</section>
</div></div>`;

describe('cli notes', () => {
  it('lists pending notes as a thread, skipping done ones', () => {
    const notes = pendingNotes(DECK);
    expect(notes.map((n: { slide: number }) => n.slide)).toEqual([1, 3]);
    expect(notes[0].title).toBe('Intro');
    expect(notes[0].x).toBe('640');
    expect(notes[0].thread).toBe('author: draw a whale here → you (earlier): Drew a whale. → author: bigger please');
    expect(notes[1].thread).toBe('plain text note');
  });
  it('renders the prompt', () => {
    const p = notesPrompt(DECK, 'deck.html');
    expect(p).toContain('deck.html: 2 note(s) for AI');
    expect(p).toContain('- Slide 1 (“Intro”) at (640, 200): author: draw a whale here');
    expect(p).toContain('data-ai-note="done"');
    expect(notesPrompt('<section></section>', 'x.html')).toBe('No pending notes for AI in x.html');
  });
});

describe('cli new', () => {
  it('scaffolds a deck', () => {
    const lib = join(root, 'dist', 'lib', 'templates.js');
    // (re)build the CLI's copy of the templates so the test sees the current source, not a stale dist/
    const sources = ['templates.ts', 'themes.ts', 'html.ts'].map((f) => statSync(join(root, 'src', 'deck', f)).mtimeMs);
    if (!existsSync(lib) || statSync(lib).mtimeMs < Math.max(...sources)) {
      execFileSync('node', [join(root, 'scripts', 'build-cli-lib.mjs')], { cwd: root, stdio: 'pipe' });
    }
    const tmp = mkdtempSync(join(tmpdir(), 'lectern-cli-'));
    try {
      const deck = join(tmp, 'deck');
      const out = execFileSync('node', [cli, 'new', deck, '--no-reveal', '--title', 'T', '--theme', 'ink', '--size', '1920x1080', '--lang', 'fr'], { cwd: root, encoding: 'utf8' });
      expect(out).toContain('created');
      const html = readFileSync(join(deck, 'index.html'), 'utf8');
      expect(html).toContain('<html lang="fr">');
      expect(html).toContain('<title>T</title>');
      expect(html).toContain('<div class="reveal">');
      expect(html).toContain('width: 1920, height: 1080');
      expect(html).toContain('cdn.jsdelivr.net/npm/reveal.js@5/dist/reveal.js');
      expect(readFileSync(join(deck, 'theme.css'), 'utf8')).toContain('Ink');
      // refuses to overwrite
      expect(() => execFileSync('node', [cli, 'new', deck, '--no-reveal'], { cwd: root, stdio: 'pipe' })).toThrow();
      // --lang defaults to en
      const deck2 = join(tmp, 'deck2');
      execFileSync('node', [cli, 'new', deck2, '--no-reveal'], { cwd: root, stdio: 'pipe' });
      expect(readFileSync(join(deck2, 'index.html'), 'utf8')).toContain('<html lang="en">');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
  it('prints help listing the subcommands', () => {
    const out = execFileSync('node', [cli, '--help'], { cwd: root, encoding: 'utf8' });
    for (const s of ['new', 'notes', 'guide', 'AI assistants', '--lang']) expect(out).toContain(s);
  });
});
