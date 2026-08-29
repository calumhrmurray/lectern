import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('docs for assistants', () => {
  it('the skill reference is a copy of AGENTS.md', () => {
    expect(readFileSync('plugins/lectern/skills/slides/reference.md', 'utf8')).toBe(readFileSync('AGENTS.md', 'utf8'));
  });
  it('AGENTS.md documents the notes protocol the code implements', () => {
    const doc = readFileSync('AGENTS.md', 'utf8');
    for (const s of ['data-ai-note="done"', '<p data-by="ai">', 'data-by="author"', 'lectern-editor notes', 'lectern-editor new']) expect(doc).toContain(s);
  });
});
