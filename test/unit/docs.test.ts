import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { starterDeckHtml } from '../../src/deck/templates';

describe('docs for assistants', () => {
  it('the skeleton in AGENTS.md is what `lectern new` writes', () => {
    const doc = readFileSync('AGENTS.md', 'utf8');
    const m = /`lectern new` writes exactly this skeleton[^]*?```html\n([^]*?)```/.exec(doc);
    expect(m, 'AGENTS.md has the skeleton fence').toBeTruthy();
    const scaffold = starterDeckHtml({ title: 'Talk title', author: 'Author', width: 1280, height: 720, revealPath: 'reveal', theme: 'paper' });
    expect(m![1].replace(/\n+$/, '')).toBe(scaffold.replace(/\n+$/, ''));
  });
  it('the skill reference is a copy of AGENTS.md', () => {
    expect(readFileSync('plugins/lectern/skills/slides/reference.md', 'utf8')).toBe(readFileSync('AGENTS.md', 'utf8'));
  });
  it('llms.txt is the same at the repo root and in what gets served', () => {
    expect(readFileSync('public/llms.txt', 'utf8')).toBe(readFileSync('llms.txt', 'utf8'));
  });
  it('the docs point at nothing that needs a hosted Lectern', () => {
    // GitHub Pages was deliberately switched off: Lectern is a local tool.
    for (const f of ['README.md', 'AGENTS.md', 'llms.txt']) {
      expect(readFileSync(f, 'utf8'), `${f} links to a hosted editor`).not.toContain('calumhrmurray.github.io');
    }
  });
  it('AGENTS.md documents the notes protocol the code implements', () => {
    const doc = readFileSync('AGENTS.md', 'utf8');
    for (const s of ['data-ai-note="done"', '<p data-by="ai">', 'data-by="author"', 'lectern-editor notes', 'lectern-editor new']) expect(doc).toContain(s);
  });
});
