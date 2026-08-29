/**
 * Inline text editing: turns the live element into a contentEditable region
 * inside the iframe, and copies the cleaned result back into the source on
 * commit. Elements containing math are edited as raw LaTeX and re-typeset.
 */

import type { Stage } from './Stage';

export interface TextSessionOptions {
  onChange?: () => void;
  /** Called after the session ends. `committed` is false when cancelled. */
  onEnd: (committed: boolean, changed: boolean) => void;
  /** Called when the user clicks outside the element (after commit). */
  onOutsidePointerDown?: (clientX: number, clientY: number, ev: PointerEvent) => void;
  /** Called for key events not consumed by the session (e.g. ⌘S). */
  onKey?: (ev: KeyboardEvent) => boolean;
}

const MATH_RE = /\$[^$]+\$|\\\(|\\\[/;

export type TextCommand = 'bold' | 'italic' | 'underline' | 'strike' | 'link' | 'unlink' | 'ul' | 'ol' | 'sup' | 'sub' | 'clear' | 'indent' | 'outdent';

export class TextSession {
  readonly live: HTMLElement;
  readonly hasMath: boolean;
  private before: string;
  private ended = false;
  private cleanup: (() => void)[] = [];

  constructor(readonly stage: Stage, readonly src: Element, readonly opts: TextSessionOptions) {
    const live = stage.liveOf(src) as HTMLElement | null;
    if (!live) throw new Error('Element is not editable (no live counterpart)');
    this.live = live;
    this.before = src.innerHTML;
    this.hasMath = MATH_RE.test(src.innerHTML) || !!live.querySelector('.katex, mjx-container, .MathJax');
  }

  start(caret?: { clientX: number; clientY: number }): void {
    const { live, stage } = this;
    if (this.hasMath) live.innerHTML = this.src.innerHTML; // edit raw LaTeX
    live.setAttribute('contenteditable', 'true');
    live.setAttribute('spellcheck', 'false');
    live.setAttribute('data-lec-editing', '1');
    stage.setTextMode(true);
    const doc = stage.doc;

    const onInput = () => this.opts.onChange?.();
    const onKeyDown = (ev: KeyboardEvent) => this.handleKey(ev);
    const onPaste = (ev: ClipboardEvent) => {
      ev.preventDefault();
      const text = ev.clipboardData?.getData('text/plain') ?? '';
      doc.execCommand('insertText', false, text);
    };
    const onDrop = (ev: DragEvent) => ev.preventDefault();
    const onPointerDownCapture = (ev: PointerEvent) => {
      if (ev.target instanceof Node && live.contains(ev.target)) return;
      const changed = this.commit();
      this.opts.onOutsidePointerDown?.(ev.clientX, ev.clientY, ev);
      void changed;
    };
    live.addEventListener('input', onInput);
    live.addEventListener('keydown', onKeyDown);
    live.addEventListener('paste', onPaste);
    live.addEventListener('drop', onDrop);
    doc.addEventListener('pointerdown', onPointerDownCapture, true);
    this.cleanup.push(() => {
      live.removeEventListener('input', onInput);
      live.removeEventListener('keydown', onKeyDown);
      live.removeEventListener('paste', onPaste);
      live.removeEventListener('drop', onDrop);
      doc.removeEventListener('pointerdown', onPointerDownCapture, true);
    });

    live.focus({ preventScroll: true });
    // Place the caret where the user double-clicked, or select all for fresh placeholders.
    const sel = stage.win.getSelection();
    if (caret && (doc as Document & { caretRangeFromPoint?: (x: number, y: number) => Range | null }).caretRangeFromPoint) {
      const r = (doc as Document & { caretRangeFromPoint: (x: number, y: number) => Range | null }).caretRangeFromPoint(caret.clientX, caret.clientY);
      if (r && live.contains(r.startContainer)) { sel?.removeAllRanges(); sel?.addRange(r); }
    } else if (sel) {
      const r = doc.createRange();
      r.selectNodeContents(live);
      sel.removeAllRanges();
      sel.addRange(r);
    }
  }

  private handleKey(ev: KeyboardEvent): void {
    // The deck's own document-level handlers must not see typing (arrow keys would flip slides).
    ev.stopPropagation();
    const mod = ev.metaKey || ev.ctrlKey;
    if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); this.commit(); return; }
    if (mod && ev.key === 'Enter') { ev.preventDefault(); ev.stopPropagation(); this.commit(); return; }
    if (mod && !ev.shiftKey && !ev.altKey) {
      const k = ev.key.toLowerCase();
      if (k === 'b') { ev.preventDefault(); this.exec('bold'); return; }
      if (k === 'i') { ev.preventDefault(); this.exec('italic'); return; }
      if (k === 'u') { ev.preventDefault(); this.exec('underline'); return; }
      if (k === 'k') { ev.preventDefault(); this.exec('link'); return; }
    }
    if (ev.key === 'Tab') {
      ev.preventDefault();
      const inList = !!this.selectionAncestor('li');
      if (inList) this.exec(ev.shiftKey ? 'outdent' : 'indent');
      return;
    }
    if (this.opts.onKey?.(ev)) { ev.preventDefault(); ev.stopPropagation(); }
  }

  private selectionAncestor(selector: string): Element | null {
    const sel = this.stage.win.getSelection();
    const node = sel?.anchorNode;
    if (!node) return null;
    const el = node.nodeType === 1 ? (node as Element) : node.parentElement;
    const found = el?.closest(selector) ?? null;
    return found && this.live.contains(found) ? found : null;
  }

  exec(cmd: TextCommand, arg?: string): void {
    const doc = this.stage.doc;
    this.live.focus({ preventScroll: true });
    switch (cmd) {
      case 'bold': doc.execCommand('bold'); break;
      case 'italic': doc.execCommand('italic'); break;
      case 'underline': doc.execCommand('underline'); break;
      case 'strike': doc.execCommand('strikeThrough'); break;
      case 'sup': doc.execCommand('superscript'); break;
      case 'sub': doc.execCommand('subscript'); break;
      case 'ul': doc.execCommand('insertUnorderedList'); break;
      case 'ol': doc.execCommand('insertOrderedList'); break;
      case 'indent': doc.execCommand('indent'); break;
      case 'outdent': doc.execCommand('outdent'); break;
      case 'clear': doc.execCommand('removeFormat'); doc.execCommand('unlink'); break;
      case 'unlink': doc.execCommand('unlink'); break;
      case 'link': {
        const existing = this.selectionAncestor('a') as HTMLAnchorElement | null;
        const url = arg ?? this.stage.win.prompt('Link URL', existing?.getAttribute('href') ?? 'https://');
        if (url === null) break;
        if (url === '') { doc.execCommand('unlink'); break; }
        if (existing) existing.setAttribute('href', url);
        else doc.execCommand('createLink', false, url);
        break;
      }
    }
    this.opts.onChange?.();
  }

  /** Inserts text at the caret. */
  insertText(text: string): void {
    this.live.focus({ preventScroll: true });
    this.stage.doc.execCommand('insertText', false, text);
  }

  /** Current formatting state (for toolbar buttons). */
  state(): { bold: boolean; italic: boolean; underline: boolean; link: boolean; list: 'ul' | 'ol' | null } {
    const doc = this.stage.doc;
    const q = (c: string) => { try { return doc.queryCommandState(c); } catch { return false; } };
    return {
      bold: q('bold'), italic: q('italic'), underline: q('underline'),
      link: !!this.selectionAncestor('a'),
      list: this.selectionAncestor('ol') ? 'ol' : this.selectionAncestor('ul') ? 'ul' : null,
    };
  }

  /** Ends the session, writing changes to the source. Returns whether anything changed. */
  commit(): boolean {
    if (this.ended) return false;
    this.ended = true;
    this.teardown();
    // Chrome sometimes leaves a trailing <br> in emptied blocks.
    if (this.live.innerHTML === '<br>') this.live.innerHTML = '';
    this.stage.commitLiveInnerHTML(this.src);
    const changed = this.src.innerHTML !== this.before;
    if (this.hasMath || changed) this.stage.typeset(this.live);
    this.opts.onEnd(true, changed);
    return changed;
  }

  /** Ends the session discarding changes. */
  cancel(): void {
    if (this.ended) return;
    this.ended = true;
    this.teardown();
    this.live.innerHTML = this.before;
    this.stage.typeset(this.live);
    this.opts.onEnd(false, false);
  }

  private teardown(): void {
    for (const fn of this.cleanup) fn();
    this.cleanup.length = 0;
    this.live.removeAttribute('contenteditable');
    this.live.removeAttribute('spellcheck');
    this.live.removeAttribute('data-lec-editing');
    this.stage.setTextMode(false);
    this.stage.win.getSelection()?.removeAllRanges();
    this.live.blur();
  }
}
