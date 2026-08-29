/**
 * Inline deck loading — for contexts without a service worker (a
 * double-clicked `Lectern.html` on `file://`). The deck's HTML is rewritten
 * so that every relative reference (stylesheets, scripts, images, fonts in
 * CSS) points at a blob: URL created from the workspace, and a small shim
 * makes `fetch()` of relative paths inside the deck read from the workspace
 * too (decks that assemble slides from part files rely on that). The result
 * is loaded into the stage iframe as `srcdoc`.
 */

import { dirname, joinPath, mimeFor, normalizePath, type Workspace } from './Workspace';

const ABSOLUTE = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i;

/** Blob URLs for workspace files, refreshed when a file is written. */
export class BlobUrlCache {
  private urls = new Map<string, string>();
  constructor(readonly ws: Workspace) {}

  async urlFor(path: string): Promise<string | null> {
    const p = normalizePath(path);
    const cached = this.urls.get(p);
    if (cached) return cached;
    try {
      const bytes = await this.ws.readBytes(p);
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mimeFor(p) }));
      this.urls.set(p, url);
      return url;
    } catch {
      return null;
    }
  }

  /** CSS files get their own `url()` references rewritten before being blobbed. */
  async cssUrlFor(path: string, depth = 0): Promise<string | null> {
    const p = normalizePath(path);
    const cached = this.urls.get(p);
    if (cached) return cached;
    let text: string;
    try { text = await this.ws.readText(p); } catch { return null; }
    const rewritten = depth < 4 ? await this.rewriteCss(text, dirname(p), depth) : text;
    const url = URL.createObjectURL(new Blob([rewritten], { type: 'text/css' }));
    this.urls.set(p, url);
    return url;
  }

  async rewriteCss(css: string, baseDir: string, depth: number): Promise<string> {
    const refs = new Map<string, string | null>();
    const re = /url\(\s*(['"]?)([^'")]+)\1\s*\)|@import\s+(['"])([^'"]+)\3/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(css))) {
      const raw = (m[2] ?? m[4]).trim();
      if (ABSOLUTE.test(raw) || raw.startsWith('data:')) continue;
      const clean = raw.split(/[?#]/)[0];
      const path = joinPath(baseDir, clean);
      if (!refs.has(path)) refs.set(path, /\.css$/i.test(clean) ? await this.cssUrlFor(path, depth + 1) : await this.urlFor(path));
    }
    return css.replace(re, (whole, q1, u1, q3, u3) => {
      const raw = (u1 ?? u3).trim();
      if (ABSOLUTE.test(raw) || raw.startsWith('data:')) return whole;
      const url = refs.get(joinPath(baseDir, raw.split(/[?#]/)[0]));
      if (!url) return whole;
      return u1 !== undefined ? `url("${url}")` : `@import "${url}"`;
    });
  }

  /**
   * Creates URLs for every file in the workspace up front (blob URLs of File
   * objects are cheap references, not copies), so that scripts the deck adds
   * at runtime (`script.src = 'katex/…'`) can be resolved synchronously.
   */
  async preload(limit = 3000): Promise<void> {
    const queue = [''];
    let count = 0;
    while (queue.length && count < limit) {
      const dir = queue.shift()!;
      let entries: { name: string; kind: string }[] = [];
      try { entries = await this.ws.list(dir); } catch { continue; }
      for (const e of entries) {
        if (e.name.startsWith('.') || e.name === 'node_modules') continue;
        const p = joinPath(dir, e.name);
        if (e.kind === 'directory') { queue.push(p); continue; }
        if (++count > limit) break;
        if (/\.css$/i.test(p)) await this.cssUrlFor(p); else await this.urlFor(p);
      }
    }
  }

  /** Cached URL for a path, if one has been created (synchronous). */
  peek(path: string): string | null {
    return this.urls.get(normalizePath(path)) ?? null;
  }

  invalidate(path: string): void {
    const p = normalizePath(path);
    const url = this.urls.get(p);
    if (url) { URL.revokeObjectURL(url); this.urls.delete(p); }
  }

  dispose(): void {
    for (const url of this.urls.values()) URL.revokeObjectURL(url);
    this.urls.clear();
  }
}

const URL_ATTRS: [string, string][] = [
  ['link[href]', 'href'], ['script[src]', 'src'], ['img[src]', 'src'], ['source[src]', 'src'], ['video[src]', 'src'],
  ['audio[src]', 'src'], ['video[poster]', 'poster'], ['iframe[src]', 'src'], ['object[data]', 'data'], ['embed[src]', 'src'],
  ['use[href]', 'href'], ['image[href]', 'href'],
];

/** The names under which the host page exposes workspace reads to the deck iframe. */
export const FETCH_BRIDGE = '__lecternFetch';
export const URL_BRIDGE = '__lecternUrl';

/**
 * Builds the `srcdoc` for a deck: relative references become blob URLs and a
 * fetch shim is injected. `deckPath` is workspace-relative.
 */
export async function inlineDeck(ws: Workspace, deckPath: string, html: string, cache: BlobUrlCache): Promise<string> {
  const baseDir = dirname(deckPath);
  const doc = new DOMParser().parseFromString(html, 'text/html');

  for (const [selector, attr] of URL_ATTRS) {
    for (const el of Array.from(doc.querySelectorAll(selector))) {
      const raw = el.getAttribute(attr);
      if (!raw || ABSOLUTE.test(raw) || raw.startsWith('data:')) continue;
      const clean = raw.split(/[?#]/)[0];
      const path = joinPath(baseDir, clean);
      const isCss = el.tagName.toLowerCase() === 'link' && (/\.css$/i.test(clean) || (el.getAttribute('rel') ?? '').includes('stylesheet'));
      const url = isCss ? await cache.cssUrlFor(path) : await cache.urlFor(path);
      if (url) el.setAttribute(attr, url);
    }
  }
  // Inline <style> blocks and style attributes may reference images/fonts.
  for (const style of Array.from(doc.querySelectorAll('style'))) {
    if (style.textContent && /url\(/.test(style.textContent)) style.textContent = await cache.rewriteCss(style.textContent, baseDir, 0);
  }
  for (const el of Array.from(doc.querySelectorAll('[style*="url("]'))) {
    el.setAttribute('style', await cache.rewriteCss(el.getAttribute('style') ?? '', baseDir, 0));
  }
  // reveal.js slide backgrounds
  for (const el of Array.from(doc.querySelectorAll('[data-background-image], [data-background-video], [data-background-iframe]'))) {
    for (const attr of ['data-background-image', 'data-background-video', 'data-background-iframe']) {
      const raw = el.getAttribute(attr);
      if (!raw || ABSOLUTE.test(raw) || raw.startsWith('data:')) continue;
      const url = await cache.urlFor(joinPath(baseDir, raw.split(/[?#]/)[0]));
      if (url) el.setAttribute(attr, url);
    }
  }

  // fetch() shim for relative paths (decks that load slides from part files).
  const shim = doc.createElement('script');
  shim.id = 'lec-fetch-shim';
  shim.textContent = `(function(){
    // about:srcdoc has no URL to write to: make history writes harmless (reveal's hash option, custom drivers).
    try {
      var h = window.history, rs = h.replaceState.bind(h), ps = h.pushState.bind(h);
      h.replaceState = function(){ try { return rs.apply(null, arguments); } catch (e) { return undefined; } };
      h.pushState = function(){ try { return ps.apply(null, arguments); } catch (e) { return undefined; } };
    } catch (e) { /* ignore */ }
    var base = ${JSON.stringify(baseDir)};
    var abs = /^(?:[a-z][a-z0-9+.-]*:|\\/\\/|#)/i;
    var orig = window.fetch;
    function join(a, b){ var parts = (a ? a + '/' : '').concat(b).split('/'); var out = []; for (var i = 0; i < parts.length; i++) { var s = parts[i]; if (!s || s === '.') continue; if (s === '..') { out.pop(); continue; } out.push(s); } return out.join('/'); }
    // Resources the deck adds at runtime (plugins loading scripts/styles, images set from script).
    function fix(url){
      if (!url || abs.test(url) || url.indexOf('data:') === 0 || url.indexOf('blob:') === 0) return url;
      var lookup = window.parent && window.parent[${JSON.stringify(URL_BRIDGE)}];
      var u = lookup ? lookup(join(base, String(url).split(/[?#]/)[0])) : null;
      return u || url;
    }
    [[HTMLScriptElement, 'src'], [HTMLLinkElement, 'href'], [HTMLImageElement, 'src'], [HTMLSourceElement, 'src'], [HTMLMediaElement, 'src'], [HTMLIFrameElement, 'src']].forEach(function(p){
      var d = Object.getOwnPropertyDescriptor(p[0].prototype, p[1]);
      if (!d || !d.set) return;
      Object.defineProperty(p[0].prototype, p[1], { get: d.get, set: function(v){ d.set.call(this, fix(String(v))); }, configurable: true });
    });
    var sa = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function(n, v){
      if ((n === 'src' || n === 'href') && /^(SCRIPT|LINK|IMG|SOURCE|VIDEO|AUDIO|IFRAME)$/.test(this.tagName)) v = fix(String(v));
      return sa.call(this, n, v);
    };
    window.fetch = function(input, init){
      var url = typeof input === 'string' ? input : (input && input.url) || '';
      if (!url || abs.test(url) || url.indexOf('data:') === 0 || url.indexOf('blob:') === 0) return orig.call(window, input, init);
      var bridge = window.parent && window.parent[${JSON.stringify(FETCH_BRIDGE)}];
      if (!bridge) return orig.call(window, input, init);
      return bridge(join(base, url.split(/[?#]/)[0])).then(function(r){ if (!r) throw new TypeError('Failed to fetch ' + url); return new Response(r.bytes, { status: 200, headers: { 'Content-Type': r.type } }); });
    };
  })();`;
  doc.head.insertBefore(shim, doc.head.firstChild);

  return '<!doctype html>\n' + doc.documentElement.outerHTML;
}

/** Installs the bridges the shim calls: byte reads and synchronous URL lookups for the deck iframe. */
export function installFetchBridge(ws: Workspace, cache: BlobUrlCache): () => void {
  const w = window as unknown as Record<string, unknown>;
  w[FETCH_BRIDGE] = async (path: string) => {
    try {
      const bytes = await ws.readBytes(path);
      return { bytes, type: mimeFor(path) };
    } catch {
      return null;
    }
  };
  w[URL_BRIDGE] = (path: string) => cache.peek(path);
  return () => { delete w[FETCH_BRIDGE]; delete w[URL_BRIDGE]; };
}
