// Lists the notes-for-AI in a deck and prints them as a prompt:  node scripts/ai-notes.mjs deck.html
// (same as `lectern notes deck.html`; the logic lives in cli/notes.js)
import { readFileSync } from 'node:fs';
import { notesPrompt } from '../cli/notes.js';
const file = process.argv[2];
if (!file) { console.error('usage: node scripts/ai-notes.mjs deck.html'); process.exit(1); }
console.log(notesPrompt(readFileSync(file, 'utf8'), file));
