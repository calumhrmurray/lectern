/**
 * Internationalisation: the editor's own strings, kept out of the code.
 *
 * The data is the source of truth and lives in `locales/*.json`; this module
 * only types it, resolves a locale and fills a key. Everything here is editor
 * chrome — nothing from this module is ever written into a deck.
 *
 * The locale is the person's stored choice, else the browser's language when it
 * is Simplified Chinese, else English. Only `zh-CN` is translated; other
 * Chinese variants (zh-TW, zh-Hant) fall back to English.
 */
import en from './locales/en.json';
import zhCN from './locales/zh-CN.json';

export type MessageKey = keyof typeof en;
export type Locale = 'en' | 'zh-CN';
export type Vars = Record<string, string | number>;

export const LOCALE_KEY = 'lectern:locale';

const catalogs: Record<Locale, Partial<Record<MessageKey, string>>> = { en, 'zh-CN': zhCN };

let locale: Locale = 'en';

/** Stored choice → the browser's language (Simplified Chinese only) → English. */
export function resolveLocale(): Locale {
  try {
    const stored = localStorage.getItem(LOCALE_KEY);
    if (stored === 'en' || stored === 'zh-CN') return stored;
  } catch { /* storage unavailable: fall through to detection */ }
  const l = (navigator.language || '').toLowerCase();
  return l === 'zh' || l.startsWith('zh-cn') || l.startsWith('zh-sg') || l.startsWith('zh-hans') ? 'zh-CN' : 'en';
}

export function setLocale(l: Locale): void { locale = l; }
export function getLocale(): Locale { return locale; }

/** Remembers the choice for next time (used by the language picker, not by detection). */
export function rememberLocale(l: Locale): void {
  try { localStorage.setItem(LOCALE_KEY, l); } catch { /* ignore */ }
}

/** The message for `key` in the current locale, with `{name}` placeholders filled. */
export function t(key: MessageKey, vars?: Vars): string {
  let s = catalogs[locale][key] ?? en[key];
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}
