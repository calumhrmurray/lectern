import { describe, expect, it } from 'vitest';
import { DeckDocument } from '../../src/deck/DeckDocument';
import { aiNotesPrompt, collectAiNotes } from '../../src/deck/aiNotes';
import { cleanRuntimeArtifacts } from '../../src/deck/html';
import { ELEMENT_TEMPLATES } from '../../src/deck/templates';

const DECK = `<html><body><div class="reveal"><div class="slides">
<section><h2>Pakicetus</h2><div hidden data-ai-note style="position:absolute;left:640px;top:200px;width:260px;">draw a whale here</div></section>
<section><h2>Two</h2><p>x</p></section>
<section><h2>Three</h2><div hidden data-ai-note style="position:absolute;left:100px;top:500px;width:300px;">explain <b>gigantism</b> here</div></section>
</div></div></body></html>`;

describe('notes for AI', () => {
  it('collects notes with their slide and position', () => {
    const d = new DeckDocument(DECK);
    const notes = collectAiNotes(d);
    expect(notes.map((n) => [n.top, n.text, n.x, n.y])).toEqual([[0, 'draw a whale here', 640, 200], [2, 'explain gigantism here', 100, 500]]);
  });
  it('writes a prompt an assistant can act on', () => {
    const d = new DeckDocument(DECK);
    const p = aiNotesPrompt(d, 'talk/index.html', { width: 1280, height: 720 });
    expect(p).toContain('talk/index.html');
    expect(p).toContain('- Slide 1 (“Pakicetus”) at (640, 200): draw a whale here');
    expect(p).toContain('- Slide 3 (“Three”) at (100, 500): explain gigantism here');
    expect(p).toContain('Remove each note element once it is done');
    expect(aiNotesPrompt(new DeckDocument('<div class="slides"><section></section></div>'), 'x', { width: 1, height: 1 })).toBe('');
  });
  it('the template is hidden and marked, and keeps `hidden` through cleaning', () => {
    const t = document.createElement('template');
    t.innerHTML = ELEMENT_TEMPLATES.ainote.html({ x: 10, y: 20, w: 300, h: 80 });
    const el = t.content.firstElementChild!;
    expect(el.hasAttribute('hidden')).toBe(true);
    expect(el.hasAttribute('data-ai-note')).toBe(true);
    const wrap = document.createElement('section');
    wrap.appendChild(el);
    el.classList.add('visible');
    cleanRuntimeArtifacts(wrap);
    expect(el.hasAttribute('hidden')).toBe(true);
    expect(el.classList.contains('visible')).toBe(false);
  });
});
