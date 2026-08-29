/** Tiny DOM builder used by the editor UI. */

type Child = Node | string | number | null | undefined | false | Child[];

export type Attrs = Record<string, unknown> | null;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: Attrs, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = String(v);
      else if (k === 'style' && typeof v === 'string') el.setAttribute('style', v);
      else if (k === 'dataset' && typeof v === 'object') Object.assign(el.dataset, v as Record<string, string>);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
      else if (k === 'html') el.innerHTML = String(v);
      else if (k in el && (typeof v === 'boolean' || k === 'value' || k === 'checked' || k === 'selected' || k === 'disabled')) (el as unknown as Record<string, unknown>)[k] = v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  append(el, children);
  return el;
}

export function append(el: Node, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) { append(el, c); continue; }
    el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
}

export function svgIcon(svg: string, cls = 'lec-icon'): HTMLElement {
  const span = document.createElement('span');
  span.className = cls;
  span.innerHTML = svg;
  span.setAttribute('aria-hidden', 'true');
  return span;
}

export function debounce<A extends unknown[]>(fn: (...a: A) => void, ms: number): (...a: A) => void {
  let t = 0;
  return (...a: A) => { clearTimeout(t); t = window.setTimeout(() => fn(...a), ms); };
}

export function isMac(): boolean {
  return /Mac|iPhone|iPad/.test(navigator.platform);
}

export function modKey(): string { return isMac() ? '⌘' : 'Ctrl+'; }

/** Converts CSS colour strings to #rrggbb (or null for transparent/invalid). */
export function toHex(color: string | null | undefined): string | null {
  if (!color) return null;
  const c = color.trim();
  if (/^#([0-9a-f]{6})$/i.test(c)) return c.toLowerCase();
  if (/^#([0-9a-f]{3})$/i.test(c)) return ('#' + c[1] + c[1] + c[2] + c[2] + c[3] + c[3]).toLowerCase();
  const m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+([\d.]+%?))?\s*\)$/i.exec(c);
  if (m) {
    if (m[4] !== undefined && parseFloat(m[4]) === 0) return null;
    const hex = (n: string) => Number(n).toString(16).padStart(2, '0');
    return `#${hex(m[1])}${hex(m[2])}${hex(m[3])}`;
  }
  if (c === 'transparent') return null;
  // Named colours: resolve through a canvas.
  try {
    const ctx = document.createElement('canvas').getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = '#000';
    ctx.fillStyle = c;
    const v = ctx.fillStyle;
    return /^#([0-9a-f]{6})$/i.test(v) ? v.toLowerCase() : null;
  } catch { return null; }
}

export function fmtNum(n: number, digits = 0): string {
  if (!isFinite(n)) return '';
  const f = 10 ** digits;
  return String(Math.round(n * f) / f);
}
