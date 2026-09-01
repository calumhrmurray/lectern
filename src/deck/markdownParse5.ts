/**
 * The `HtmlParser` for plain node: parse5 with source offsets, so raw HTML islands are
 * byte-exact slices of the file. Bundled into `dist/lib/markdown.js` for the CLI;
 * the browser build uses `treeFromDom` instead and never loads parse5.
 */

import { parse } from 'parse5';
import type { HNode } from './markdown';

interface P5Node {
  nodeName: string;
  tagName?: string;
  value?: string;
  data?: string;
  attrs?: { name: string; value: string }[];
  childNodes?: P5Node[];
  sourceCodeLocation?: { startOffset: number; endOffset: number } | null;
}

function conv(n: P5Node): HNode | null {
  if (n.nodeName === '#text') return { type: 'text', text: n.value ?? '' };
  if (n.nodeName === '#comment') return { type: 'comment', text: n.data ?? '' };
  if (n.nodeName.startsWith('#') && n.nodeName !== '#document' && n.nodeName !== '#document-fragment') return null;
  const children = (n.childNodes ?? []).map(conv).filter((x): x is HNode => !!x);
  if (n.nodeName === '#document' || n.nodeName === '#document-fragment') return { type: 'element', tag: '#root', attrs: {}, children };
  const attrs: Record<string, string> = {};
  for (const a of n.attrs ?? []) attrs[a.name] = a.value;
  return {
    type: 'element', tag: (n.tagName ?? n.nodeName).toLowerCase(), attrs, children,
    start: n.sourceCodeLocation?.startOffset, end: n.sourceCodeLocation?.endOffset,
  };
}

/** Parses a whole HTML document into `HNode`s with source offsets. */
export function parseHtml(html: string): HNode[] {
  const doc = parse(html, { sourceCodeLocationInfo: true }) as unknown as P5Node;
  const root = conv(doc);
  return root && root.type === 'element' ? root.children : [];
}
