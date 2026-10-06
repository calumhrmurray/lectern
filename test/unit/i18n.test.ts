import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import en from '../../src/i18n/locales/en.json';
import { t } from '../../src/i18n';
import { ELEMENT_TEMPLATES, SLIDE_LAYOUTS } from '../../src/deck/templates';

const KEY = /^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9-]+)+$/;
const CATALOG = en as Record<string, unknown>;
const has = (k: string): boolean => Object.prototype.hasOwnProperty.call(CATALOG, k);

describe('i18n catalog', () => {
  it('en has namespaced keys and non-empty string values', () => {
    for (const [k, v] of Object.entries(CATALOG)) {
      expect(k).toMatch(KEY);
      expect(typeof v).toBe('string');
      expect(String(v).length).toBeGreaterThan(0);
    }
  });

  it('every locale file has exactly the keys of en', () => {
    // The catalog is the source of truth: a translation may be missing (it falls
    // back to en at runtime), but the key sets are expected to line up.
    const dir = join(process.cwd(), 'src', 'i18n', 'locales');
    const enKeys = Object.keys(CATALOG).sort();
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.json'))) {
      const data = JSON.parse(readFileSync(join(dir, f), 'utf8')) as Record<string, unknown>;
      expect(Object.keys(data).sort()).toEqual(enKeys);
    }
  });

  it('slide-layout and element template labels exist in the catalog', () => {
    const missing: string[] = [];
    for (const l of SLIDE_LAYOUTS) {
      if (!has(l.nameKey)) missing.push(l.nameKey);
      if (l.hintKey && !has(l.hintKey)) missing.push(l.hintKey);
    }
    for (const tpl of Object.values(ELEMENT_TEMPLATES)) if (!has(tpl.nameKey)) missing.push(tpl.nameKey);
    expect(missing).toEqual([]);
  });

  it('every literal data-i18n hook names a real key', () => {
    const src = join(process.cwd(), 'src');
    const files: string[] = [];
    const walk = (d: string): void => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (p.endsWith('.ts')) files.push(p);
      }
    };
    walk(src);
    const re = /['"]?data-i18n['"]?\s*[:=]\s*['"]([a-zA-Z0-9.-]+)['"]/g;
    const found: string[] = [];
    for (const f of files) for (const m of readFileSync(f, 'utf8').matchAll(re)) found.push(m[1]);
    expect(found.length).toBeGreaterThan(0);
    expect(found.filter((k) => !has(k))).toEqual([]);
  });

  it('t() fills {placeholders} and resolves a plain key', () => {
    expect(t('editor.undo.insert', { what: 'Table' })).toBe('Insert Table');
    expect(t('status.position', { label: '2', i: 2, n: 7 })).toBe('Slide 2 · 2 / 7');
    expect(t('common.ok')).toBe('OK');
  });
});
