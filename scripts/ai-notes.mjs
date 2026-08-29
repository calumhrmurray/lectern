// Lists the notes-for-AI in a deck and prints them as a prompt:  node scripts/ai-notes.mjs deck.html
import { readFileSync } from 'node:fs';
const file = process.argv[2];
if (!file) { console.error('usage: node scripts/ai-notes.mjs deck.html'); process.exit(1); }
const html = readFileSync(file, 'utf8');
const sections = [...html.matchAll(/<section\b[\s\S]*?<\/section>/g)].map((m) => m[0]);
let n = 0;
const out = [];
sections.forEach((sec, i) => {
  for (const m of sec.matchAll(/<div[^>]*\bdata-ai-note\b[^>]*>([\s\S]*?)<\/div>/g)) {
    n++;
    const style = /style="([^"]*)"/.exec(m[0])?.[1] ?? '';
    const x = /left\s*:\s*(-?[\d.]+)px/.exec(style)?.[1];
    const y = /top\s*:\s*(-?[\d.]+)px/.exec(style)?.[1];
    const title = /<h[12][^>]*>([\s\S]*?)<\/h[12]>/.exec(sec)?.[1]?.replace(/<[^>]+>/g, '').trim();
    out.push(`- Slide ${i + 1}${title ? ` (“${title}”)` : ''}${x && y ? ` at (${x}, ${y})` : ''}: ${m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()}`);
  }
});
if (!n) { console.log('No notes for AI in', file); process.exit(0); }
console.log(`${file}: ${n} note(s) for AI (elements marked data-ai-note; positions are slide coordinates):\n`);
console.log(out.join('\n'));
console.log('\nDo what each note asks in the file itself, keeping the deck\'s style, and remove each note element once done.');
