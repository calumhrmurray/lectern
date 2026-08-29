/**
 * Notes for an AI in a deck: `<div hidden data-ai-note …>` elements inside slides.
 * `notesPrompt(html, file)` renders the pending ones as a prompt an assistant can act on.
 * Used by `lectern notes deck.html` and scripts/ai-notes.mjs.
 */

const strip = (s) => s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

/** Pending notes, in document order: [{ slide, title, x, y, thread }]. */
export function pendingNotes(html) {
  const sections = [...html.matchAll(/<section\b[\s\S]*?<\/section>/g)].map((m) => m[0]);
  const out = [];
  sections.forEach((sec, i) => {
    for (const m of sec.matchAll(/<div[^>]*\bdata-ai-note\b[^>]*>([\s\S]*?)<\/div>/g)) {
      if (/data-ai-note="done"/.test(m[0])) continue;
      const style = /style="([^"]*)"/.exec(m[0])?.[1] ?? '';
      const x = /left\s*:\s*(-?[\d.]+)px/.exec(style)?.[1];
      const y = /top\s*:\s*(-?[\d.]+)px/.exec(style)?.[1];
      const title = /<h[12][^>]*>([\s\S]*?)<\/h[12]>/.exec(sec)?.[1]?.replace(/<[^>]+>/g, '').trim();
      const inner = m[1];
      const ps = [...inner.matchAll(/<p[^>]*data-by="(author|ai)"[^>]*>([\s\S]*?)<\/p>/g)].map((q) => `${q[1] === 'ai' ? 'you (earlier)' : 'author'}: ${strip(q[2])}`);
      const thread = ps.length ? ps.join(' → ') : strip(inner);
      out.push({ slide: i + 1, title: title || null, x: x ?? null, y: y ?? null, thread });
    }
  });
  return out;
}

/** The prompt printed by `lectern notes`. */
export function notesPrompt(html, file) {
  const notes = pendingNotes(html);
  if (!notes.length) return `No pending notes for AI in ${file}`;
  const lines = notes.map((n) => `- Slide ${n.slide}${n.title ? ` (“${n.title}”)` : ''}${n.x && n.y ? ` at (${n.x}, ${n.y})` : ''}: ${n.thread}`);
  return [
    `${file}: ${notes.length} note(s) for AI (elements marked data-ai-note; positions are slide coordinates):`,
    '',
    lines.join('\n'),
    '',
    'Do what each note asks in the file itself, keeping the deck\'s style. Do not delete notes: when one is done, append <p data-by="ai">what you did</p> inside it and set data-ai-note="done".',
  ].join('\n');
}
