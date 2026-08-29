/**
 * Undo/redo history built on whole-section snapshots.
 *
 * Every user-visible edit is recorded as a pair of snapshots (before/after)
 * of either one top-level section or the whole slide list. Restoring a
 * snapshot is a deterministic DOM replacement, which keeps undo trivially
 * correct no matter how complicated the edit was.
 */

import type { Snapshot } from './DeckDocument';

export interface HistoryEntry {
  label: string;
  before: Snapshot;
  after: Snapshot;
  /** Optional selection hint to restore after undo/redo. */
  selection?: { slide: number; paths: number[][] };
}

export class History {
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  readonly limit: number;
  private listeners = new Set<() => void>();

  constructor(limit = 200) { this.limit = limit; }

  get canUndo(): boolean { return this.undoStack.length > 0; }
  get canRedo(): boolean { return this.redoStack.length > 0; }
  get undoLabel(): string | null { return this.undoStack.at(-1)?.label ?? null; }
  get redoLabel(): string | null { return this.redoStack.at(-1)?.label ?? null; }

  /** The most recent entry (without popping). */
  peek(): HistoryEntry | null { return this.undoStack.at(-1) ?? null; }

  push(entry: HistoryEntry): void {
    this.undoStack.push(entry);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack.length = 0;
    this.emit();
  }

  /** Pops the most recent entry to be undone. The caller restores `before`. */
  undo(): HistoryEntry | null {
    const e = this.undoStack.pop();
    if (!e) return null;
    this.redoStack.push(e);
    this.emit();
    return e;
  }

  /** Pops the most recent undone entry. The caller restores `after`. */
  redo(): HistoryEntry | null {
    const e = this.redoStack.pop();
    if (!e) return null;
    this.undoStack.push(e);
    this.emit();
    return e;
  }

  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.emit();
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void { for (const fn of this.listeners) fn(); }
}
