/**
 * Discovers the CSS classes a deck's own stylesheets define, so the inspector
 * can offer them as toggles (`.kicker`, `.tide`, `.fig` …). Reveal's core
 * stylesheets and third-party libraries are skipped.
 */

export interface ThemeClass {
  name: string;
  /** Example selector where the class appears, for a tooltip. */
  selector: string;
  /** How many rules mention it (used for sorting). */
  count: number;
  /** Tags the class is scoped to in selectors (e.g. `img` for `img.fig`), if any. */
  tags: Set<string>;
}

const SKIP_SHEET = /(^|\/)(reveal|reset|katex|highlight|monokai|zenburn|github|plugin\/)[^/]*\.css/i;
const SKIP_CLASS = new Set([
  'reveal', 'slides', 'present', 'past', 'future', 'stack', 'visible', 'fragment', 'current-fragment',
  'backgrounds', 'slide-background', 'progress', 'controls', 'notes', 'reveal-viewport', 'katex', 'hljs',
  'navigate-left', 'navigate-right', 'navigate-up', 'navigate-down', 'overview', 'has-dark-background', 'has-light-background',
]);

export function discoverThemeClasses(doc: Document): ThemeClass[] {
  const found = new Map<string, ThemeClass>();
  const sheets = Array.from(doc.styleSheets) as CSSStyleSheet[];
  for (const sheet of sheets) {
    if (sheet.href && SKIP_SHEET.test(sheet.href)) continue;
    if ((sheet.ownerNode as Element | null)?.id === 'lec-editing-styles') continue;
    let rules: CSSRuleList;
    try { rules = sheet.cssRules; } catch { continue; } // cross-origin
    collect(rules, found);
  }
  return Array.from(found.values())
    .filter((c) => !SKIP_CLASS.has(c.name) && !c.name.startsWith('fragment') && !c.name.startsWith('r-') && !c.name.startsWith('lec-'))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// `instanceof CSSStyleRule` fails across realms (the sheets live in the deck iframe), so duck-type.
const STYLE_RULE = 1, MEDIA_RULE = 4, SUPPORTS_RULE = 12;
function isStyleRule(rule: CSSRule): rule is CSSStyleRule { return rule.type === STYLE_RULE && 'selectorText' in rule; }
function isGroupRule(rule: CSSRule): rule is CSSGroupingRule { return (rule.type === MEDIA_RULE || rule.type === SUPPORTS_RULE) && 'cssRules' in rule; }

function collect(rules: CSSRuleList, found: Map<string, ThemeClass>): void {
  for (const rule of Array.from(rules)) {
    if (isStyleRule(rule)) {
      const selectors = rule.selectorText.split(',');
      for (const sel of selectors) {
        const re = /(?:^|[\s>+~(])([a-zA-Z][\w-]*)?((?:\.[A-Za-z_][\w-]*)+)/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(sel))) {
          const tag = m[1]?.toLowerCase();
          for (const cls of m[2].split('.').filter(Boolean)) {
            const entry = found.get(cls) ?? { name: cls, selector: sel.trim(), count: 0, tags: new Set<string>() };
            entry.count++;
            if (tag) entry.tags.add(tag);
            found.set(cls, entry);
          }
        }
      }
    } else if (isGroupRule(rule)) {
      collect(rule.cssRules, found);
    }
  }
}

/** Font families named by the deck's stylesheets (for the font picker). */
export function discoverFontFamilies(doc: Document): string[] {
  const fonts = new Set<string>();
  const sheets = Array.from(doc.styleSheets) as CSSStyleSheet[];
  for (const sheet of sheets) {
    if (sheet.href && /katex|highlight/i.test(sheet.href)) continue;
    let rules: CSSRuleList;
    try { rules = sheet.cssRules; } catch { continue; }
    for (const rule of Array.from(rules)) {
      if (isStyleRule(rule)) {
        const ff = rule.style.getPropertyValue('font-family');
        if (ff && !ff.includes('var(')) fonts.add(ff.trim());
      }
    }
  }
  return Array.from(fonts);
}

/** CSS custom properties (variables) defined on :root, with their values. */
export function discoverCssVariables(doc: Document): { name: string; value: string }[] {
  const out: { name: string; value: string }[] = [];
  const cs = doc.defaultView?.getComputedStyle(doc.documentElement);
  const sheets = Array.from(doc.styleSheets) as CSSStyleSheet[];
  const names = new Set<string>();
  for (const sheet of sheets) {
    let rules: CSSRuleList;
    try { rules = sheet.cssRules; } catch { continue; }
    for (const rule of Array.from(rules)) {
      if (isStyleRule(rule) && /:root|^html$/.test(rule.selectorText)) {
        for (let i = 0; i < rule.style.length; i++) {
          const p = rule.style[i];
          if (p.startsWith('--')) names.add(p);
        }
      }
    }
  }
  for (const name of names) {
    const value = (cs?.getPropertyValue(name) ?? '').trim();
    out.push({ name, value });
  }
  return out;
}
