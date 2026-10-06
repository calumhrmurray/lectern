/**
 * Internationalisation: the editor's own strings, kept out of the code.
 *
 * The data is the source of truth and lives in `locales/*.json`; this module
 * only types it and resolves a key for the current locale. PR1 ships English
 * alone and never switches by itself — the editor stays English unless
 * something explicitly calls `setLocale` (PR2 adds detection and a picker).
 *
 * Everything here is editor chrome. Nothing from this module is ever written
 * into a deck.
 */
import en from './locales/en.json';
import zhCN from './locales/zh-CN.json';

export type MessageKey = keyof typeof en;
export type Locale = 'en' | 'zh-CN';
export type Vars = Record<string, string | number>;

const catalogs: Record<Locale, Partial<Record<MessageKey, string>>> = { en, 'zh-CN': zhCN };

let locale: Locale = 'en';

export function setLocale(l: Locale): void { locale = l; }
export function getLocale(): Locale { return locale; }

/** The message for `key` in the current locale, with `{name}` placeholders filled. */
export function t(key: MessageKey, vars?: Vars): string {
  let s = catalogs[locale][key] ?? en[key];
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}
