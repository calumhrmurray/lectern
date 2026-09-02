/**
 * Slide thumbnails: each is a small `srcdoc` iframe that loads the deck's own
 * stylesheets and shows a clone of the *rendered* slide (so KaTeX output,
 * theme fonts and inline styles all match the canvas), scaled with a CSS
 * transform.
 */

import type { Editor } from '../app/Editor';
import type { SlideRef } from '../stage/Stage';

export class ThumbnailRenderer {
  private headCache: string | null = null;

  constructor(readonly editor: Editor) {}

  invalidate(): void { this.headCache = null; }

  /** Stylesheets and inline styles from the live deck, plus a <base> for relative URLs. */
  private headHtml(): string {
    if (this.headCache) return this.headCache;
    const stage = this.editor.stage;
    const doc = stage.doc;
    const parts: string[] = stage.iframe.src ? [`<base href="${escapeAttr(stage.iframe.src)}">`] : [];
    for (const node of Array.from(doc.querySelectorAll('link[rel~="stylesheet"], style'))) {
      if (node.id === 'lec-editing-styles') continue;
      // The deck's elements live in the iframe's realm, so `instanceof HTMLLinkElement`
      // is false for them here: duck-type on the tag instead.
      if (node.tagName === 'LINK') {
        parts.push(`<link rel="stylesheet" href="${escapeAttr((node as HTMLLinkElement).href)}">`);
      } else {
        parts.push(`<style>${node.textContent ?? ''}</style>`);
      }
    }
    const { width, height } = stage.slideSize;
    const plain = stage.kind === 'plain';
    parts.push(plain ? `<style>
      html, body { margin: 0; width: ${width}px; height: ${height}px; overflow: hidden; }
      .lec-slides > section { display: ${escapeAttr(stage.plainConventions.display)} !important; opacity: 1 !important; visibility: visible !important; transition: none !important; }
      .lec-slides section .fragment { visibility: visible !important; opacity: 1 !important; transform: none !important; }
      .lec-slides section aside.notes { display: none !important; }
      [data-ai-note] { display: block !important; background: #fff3a8; border: 1px solid #e2c34e; border-radius: 6px; padding: 10px; font: 600 0.58em/1.35 sans-serif; color: #4a3a00; box-sizing: border-box; min-height: 2em; }
      [data-ai-note="done"] { background: #dff5dc; border-color: #7cc47a; color: #1f4d24; }
      [data-ai-note] > p { margin: 0; padding: 2px 0; }
      [data-ai-note] > p[data-by="ai"] { color: #2f7d3a; }
      .lec-bg { position: absolute; inset: 0; z-index: 0; background-size: cover; background-position: center; background-repeat: no-repeat; }
    </style>` : `<style>
      html, body { margin: 0; width: ${width}px; height: ${height}px; overflow: hidden; }
      .reveal { position: relative; width: ${width}px; height: ${height}px; overflow: hidden; }
      .reveal .slides { position: absolute; left: 0; top: 0; width: ${width}px; height: ${height}px; margin: 0; transform: none !important; zoom: 1; overflow: hidden; pointer-events: none; }
      .reveal .slides > section, .reveal .slides > section > section { display: block !important; visibility: visible !important; opacity: 1 !important; position: absolute; left: 0; width: 100%; transform: none !important; transition: none !important; }
      .reveal .slides section .fragment { visibility: visible !important; opacity: 1 !important; transform: none !important; }
      .reveal .slides section aside.notes { display: none !important; }
      [data-ai-note] { display: block !important; background: #fff3a8; border: 1px solid #e2c34e; border-radius: 6px; padding: 10px; font: 600 0.58em/1.35 sans-serif; color: #4a3a00; box-sizing: border-box; }
      [data-ai-note="done"] { background: #dff5dc; border-color: #7cc47a; color: #1f4d24; }
      [data-ai-note] > p { margin: 0; padding: 2px 0; }
      [data-ai-note] > p[data-by="ai"] { color: #2f7d3a; }
      .lec-bg { position: absolute; inset: 0; z-index: 0; background-size: cover; background-position: center; background-repeat: no-repeat; }
      .reveal .controls, .reveal .progress, .reveal .slide-number { display: none !important; }
    </style>`);
    this.headCache = parts.join('\n');
    return this.headCache;
  }

  /** Renders the given slide into `iframe` (whose size is the full slide size; scale it with CSS). */
  render(ref: SlideRef, iframe: HTMLIFrameElement): void {
    const stage = this.editor.stage;
    if (!stage.ready) return;
    let live: Element;
    try { live = stage.liveSection(ref); } catch { return; }
    const clone = live.cloneNode(true) as HTMLElement;
    clone.classList.remove('past', 'future', 'stack');
    clone.classList.add('present');
    clone.removeAttribute('hidden');
    clone.removeAttribute('aria-hidden');
    clone.style.display = 'block';
    for (const sub of Array.from(clone.querySelectorAll(':scope > section'))) sub.remove();
    for (const f of Array.from(clone.querySelectorAll('.fragment'))) f.classList.add('visible');
    for (const ed of Array.from(clone.querySelectorAll('[contenteditable]'))) ed.removeAttribute('contenteditable');
    // Canvas content does not survive cloning; snapshot it.
    const liveCanvases = Array.from(live.querySelectorAll('canvas'));
    const cloneCanvases = Array.from(clone.querySelectorAll('canvas'));
    cloneCanvases.forEach((c, i) => {
      const src = liveCanvases[i];
      try {
        const img = clone.ownerDocument.createElement('img');
        img.src = src.toDataURL();
        img.setAttribute('style', c.getAttribute('style') ?? '');
        img.className = c.className;
        img.width = src.width; img.height = src.height;
        c.replaceWith(img);
      } catch { /* tainted canvas: leave blank */ }
    });
    const bg = backgroundStyle(live);
    const htmlEl = stage.doc.documentElement;
    const body = stage.doc.body;
    let html: string;
    if (stage.kind === 'plain') {
      // Replicate the deck's own container (tag, id, classes) so its CSS applies.
      const root = stage.liveSlidesRoot;
      const conv = stage.plainConventions;
      if (conv.activeClass) clone.classList.add(conv.activeClass);
      clone.classList.remove('lec-textmode');
      const attrs = Array.from(root.attributes).filter((a) => a.name !== 'style').map((a) => `${a.name}="${escapeAttr(a.name === 'class' ? a.value.replace(/\blec-\S+/g, '') : a.value)}"`).join(' ');
      const tag = root.tagName.toLowerCase();
      html = `<!doctype html><html class="${escapeAttr(htmlEl.className.replace(/\blec-\S+/g, ''))}"><head>${this.headHtml()}</head>` +
        `<body class="${escapeAttr(body.className)}"><${tag} ${attrs} class="lec-slides ${escapeAttr(root.className.replace(/\blec-\S+/g, ''))}">` +
        `<div class="lec-bg" style="${escapeAttr(bg)}"></div>${clone.outerHTML}</${tag}></body></html>`;
    } else {
      html = `<!doctype html><html class="${escapeAttr(htmlEl.className)}"><head>${this.headHtml()}</head>` +
        `<body class="${escapeAttr(body.className)}"><div class="reveal"><div class="slides">` +
        `<div class="lec-bg" style="${escapeAttr(bg)}"></div>${clone.outerHTML}</div></div></body></html>`;
    }
    iframe.srcdoc = html;
  }
}

function backgroundStyle(section: Element): string {
  const get = (n: string) => section.getAttribute(n);
  const out: string[] = [];
  const color = get('data-background-color') ?? get('data-background');
  if (color && !/^(https?:|\.|\/|[\w-]+\.(png|jpe?g|gif|svg|webp))/i.test(color)) out.push(`background-color:${color}`);
  const image = get('data-background-image') ?? (get('data-background') && /\.(png|jpe?g|gif|svg|webp)(\?|$)/i.test(get('data-background')!) ? get('data-background') : null);
  if (image) out.push(`background-image:url("${image.replace(/"/g, '%22')}")`);
  const gradient = get('data-background-gradient');
  if (gradient) out.push(`background-image:${gradient}`);
  const size = get('data-background-size');
  if (size) out.push(`background-size:${size}`);
  const pos = get('data-background-position');
  if (pos) out.push(`background-position:${pos}`);
  const repeat = get('data-background-repeat');
  if (repeat) out.push(`background-repeat:${repeat}`);
  const opacity = get('data-background-opacity');
  if (opacity) out.push(`opacity:${opacity}`);
  return out.join(';');
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
