import { describe, expect, it } from 'vitest';
import { patchInlineStyle, splitDeclarations } from '../../src/deck/html';

function el(style?: string): HTMLElement {
  const d = document.createElement('div');
  if (style !== undefined) d.setAttribute('style', style);
  return d;
}

describe('splitDeclarations', () => {
  it('respects parentheses and quotes', () => {
    expect(splitDeclarations('background:url("a;b.png");color:rgb(1, 2, 3);font-family:"x;y"')).toEqual(['background:url("a;b.png")', 'color:rgb(1, 2, 3)', 'font-family:"x;y"']);
  });
});

describe('patchInlineStyle', () => {
  it('keeps untouched declarations verbatim and appends new ones', () => {
    const d = el('position:absolute;left:120px;background:#4a7bd0;');
    patchInlineStyle(d, { left: '130px', top: '20px' });
    expect(d.getAttribute('style')).toBe('position:absolute;left:130px;background:#4a7bd0;top:20px;');
  });
  it('matches the spaced style of the author', () => {
    const d = el('color: #fff; margin: 0;');
    patchInlineStyle(d, { 'font-size': '24px' });
    expect(d.getAttribute('style')).toBe('color: #fff; margin: 0; font-size: 24px;');
  });
  it('removes properties and drops the attribute when empty', () => {
    const d = el('left:1px;top:2px');
    patchInlineStyle(d, { left: null, top: '' });
    expect(d.hasAttribute('style')).toBe(false);
  });
  it('creates the attribute when missing', () => {
    const d = el();
    patchInlineStyle(d, { position: 'relative', left: '3px' });
    expect(d.getAttribute('style')).toBe('position:relative;left:3px;');
  });
  it('collapses duplicate declarations of a patched property', () => {
    const d = el('left:1px;color:red;left:2px');
    patchInlineStyle(d, { left: '9px' });
    expect(d.getAttribute('style')).toBe('left:9px;color:red;');
  });
});
