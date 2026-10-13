import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import en from '../../src/i18n/locales/en.json';
import { LOCALE_KEY, resolveLocale, t } from '../../src/i18n';
import { ELEMENT_TEMPLATES, SLIDE_LAYOUTS } from '../../src/deck/templates';
import { DECK_THEMES } from '../../src/deck/themes';

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

  it('theme descriptions exist in the catalog', () => {
    const missing = DECK_THEMES.filter((th) => !has(th.descriptionKey)).map((th) => th.descriptionKey);
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

  it('every locale keeps the same {placeholders} as en', () => {
    const holes = (s: string): string[] => (s.match(/\{[a-zA-Z]+\}/g) ?? []).sort();
    const zh = JSON.parse(readFileSync(join(process.cwd(), 'src', 'i18n', 'locales', 'zh-CN.json'), 'utf8')) as Record<string, string>;
    for (const [k, v] of Object.entries(CATALOG as Record<string, string>)) expect(holes(zh[k] ?? ''), k).toEqual(holes(v));
  });

  it('resolveLocale prefers a stored choice, then Simplified Chinese, else en', () => {
    const m = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      get length() { return m.size; },
      clear: () => m.clear(),
      getItem: (k: string) => (m.has(k) ? (m.get(k) as string) : null),
      key: (i: number) => [...m.keys()][i] ?? null,
      removeItem: (k: string) => { m.delete(k); },
      setItem: (k: string, v: string) => { m.set(k, String(v)); },
    });
    const about = (lang: string): void => { Object.defineProperty(navigator, 'language', { value: lang, configurable: true }); m.clear(); };
    about('zh-CN'); expect(resolveLocale()).toBe('zh-CN');
    about('zh-Hans-CN'); expect(resolveLocale()).toBe('zh-CN');
    about('en-GB'); expect(resolveLocale()).toBe('en');
    about('zh-TW'); expect(resolveLocale()).toBe('en'); // Traditional falls back to English
    about('zh-Hant'); expect(resolveLocale()).toBe('en');
    about('zh-TW'); localStorage.setItem(LOCALE_KEY, 'zh-CN'); expect(resolveLocale()).toBe('zh-CN');
    about('zh-CN'); localStorage.setItem(LOCALE_KEY, 'en'); expect(resolveLocale()).toBe('en');
    vi.unstubAllGlobals();
  });

  it('t() fills {placeholders} and resolves a plain key', () => {
    expect(t('editor.undo.insert', { what: 'Table' })).toBe('Insert Table');
    expect(t('status.position', { label: '2', i: 2, n: 7 })).toBe('Slide 2 · 2 / 7');
    expect(t('common.ok')).toBe('OK');
  });
});
