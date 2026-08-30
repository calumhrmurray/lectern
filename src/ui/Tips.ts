/**
 * Tips: the few things the quiet room cannot say for itself.
 *
 * Hiding the chrome costs a newcomer the labels, so a handful of tips buy them
 * back. The rule is that a tip appears when the thing it describes has become
 * relevant — you selected something, you landed in a stack, you flipped the
 * lights by accident — rather than all at once on arrival, which is a tour, and
 * a tour is read once and remembered never.
 *
 * Two exceptions open the deck, because nothing on screen would ever prompt
 * them: that a double-click leaves a note for the assistant, and that the panels
 * are one key away.
 *
 * Each tip is shown once, ever, and remembered across sessions.
 */

import type { App } from '../app/App';
import { h } from './dom';

export type TipId = 'note' | 'panels' | 'select' | 'stack' | 'autosave' | 'map' | 'room';

interface Tip {
  text: string;
  /** Where to put it; the slide itself when there is nothing better. */
  anchor: (app: App) => DOMRect | null;
  /** Which side of the anchor to sit on. */
  place?: 'above' | 'below';
}

const SEEN = 'lectern:tips:seen';
const OFF = 'lectern:tips';

const TIPS: Record<TipId, Tip> = {
  note: {
    text: 'Double-click an empty part of the slide to leave a note for your assistant. Where the slide is full, right-click instead — the note lands where you point.',
    anchor: (app) => rectOf(app.editor.slideBoxOnPage()),
    place: 'below',
  },
  panels: {
    text: 'The panels are hidden. Q brings them back, M opens the map, and holding space shows everything for a look.',
    anchor: (app) => app.barRect(),
    place: 'above',
  },
  select: {
    text: 'Drag to move it, the handles resize it, and Esc lets go. Double-click text to edit the words.',
    anchor: (app) => rectOf(app.editor.slideBoxOnPage()),
    place: 'below',
  },
  stack: {
    text: 'This slide has slides below it: ↓ goes down the stack, → goes on to the next one along.',
    anchor: (app) => app.compassRect(),
    place: 'below',
  },
  autosave: {
    text: 'Saved as you go, straight into the .html file — no export step.',
    anchor: (app) => app.counterRect(),
    place: 'above',
  },
  map: {
    text: 'Click a title to rename it, drag a card to reorder, or drop one under another to make it a sub-slide.',
    anchor: (app) => app.mapHeadRect(),
    place: 'below',
  },
  room: {
    text: 'That was the background — click it again for the other room.',
    anchor: (app) => rectOf(app.editor.slideBoxOnPage()),
    place: 'above',
  },
};

function rectOf(box: { left: number; top: number; width: number; height: number } | null): DOMRect | null {
  return box ? new DOMRect(box.left, box.top, box.width, box.height) : null;
}

export class Tips {
  private el: HTMLElement | null = null;
  private timer = 0;
  private queue: TipId[] = [];
  private showing: TipId | null = null;

  constructor(readonly app: App) {}

  get enabled(): boolean { return localStorage.getItem(OFF) !== 'off'; }

  private seen(): Set<string> {
    try { return new Set(JSON.parse(localStorage.getItem(SEEN) ?? '[]') as string[]); } catch { return new Set(); }
  }

  private remember(id: TipId): void {
    const s = this.seen();
    s.add(id);
    localStorage.setItem(SEEN, JSON.stringify([...s]));
  }

  /** Shows a tip if it has never been shown. Later tips wait for the current one. */
  show(id: TipId): void {
    if (!this.enabled || this.seen().has(id) || this.queue.includes(id) || this.showing === id) return;
    if (!this.app.quiet) return; // the panelled view labels its own controls
    this.queue.push(id);
    if (!this.showing) this.next();
  }

  /** Forgets what has been shown, so the tips run again. */
  reset(): void {
    localStorage.removeItem(SEEN);
    localStorage.setItem(OFF, 'on');
    this.dismiss();
    this.show('note');
    this.show('panels');
  }

  setEnabled(on: boolean): void {
    localStorage.setItem(OFF, on ? 'on' : 'off');
    if (!on) { this.queue = []; this.dismiss(); }
  }

  dismiss(): void {
    clearTimeout(this.timer);
    this.el?.remove();
    this.el = null;
    const done = this.showing;
    this.showing = null;
    if (done) this.next();
  }

  private next(): void {
    const id = this.queue.shift();
    if (!id) return;
    const tip = TIPS[id];
    const anchor = tip.anchor(this.app);
    if (!anchor) { this.remember(id); this.next(); return; } // nothing to point at: skip, do not hoard it
    this.showing = id;
    this.remember(id);

    const el = h('div', { class: 'lec-tip', role: 'status' },
      h('span', {}, tip.text),
      h('button', { class: 'lec-tip-x', type: 'button', title: 'Got it', onclick: () => this.dismiss() }, 'Got it'),
    );
    document.body.appendChild(el);
    this.el = el;

    // Sit beside what it is about, and stay on screen.
    const r = el.getBoundingClientRect();
    const gap = 12;
    let top = tip.place === 'above' ? anchor.top - r.height - gap : anchor.bottom + gap;
    if (top < 8) top = anchor.bottom + gap;
    if (top + r.height > window.innerHeight - 8) top = Math.max(8, anchor.top - r.height - gap);
    let left = anchor.left + anchor.width / 2 - r.width / 2;
    left = Math.max(12, Math.min(left, window.innerWidth - r.width - 12));
    el.style.top = `${Math.round(top)}px`;
    el.style.left = `${Math.round(left)}px`;
    requestAnimationFrame(() => el.classList.add('lec-in'));
    this.timer = window.setTimeout(() => this.dismiss(), 14000);
  }
}
