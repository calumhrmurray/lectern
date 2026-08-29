import { describe, expect, it } from 'vitest';
import { cleanRuntimeArtifacts, isSelectableDisplay, pathOf, resolvePath, selectionTarget, slideLabel, isStack } from '../../src/deck/html';

function parse(html: string): Element {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild!;
}

describe('paths', () => {
  it('computes and resolves index paths', () => {
    const root = parse('<section><h2>a</h2><div><p>b</p><ul><li>c</li><li>d</li></ul></div></section>');
    const li = root.querySelectorAll('li')[1];
    const path = pathOf(li, root)!;
    expect(path).toEqual([1, 1, 1]);
    expect(resolvePath(root, path)).toBe(li);
    expect(pathOf(root, root)).toEqual([]);
    expect(resolvePath(root, [5])).toBeNull();
  });
  it('returns null for elements outside root', () => {
    const a = parse('<section><p>x</p></section>');
    const b = parse('<section><p>y</p></section>');
    expect(pathOf(b.firstElementChild!, a)).toBeNull();
  });
});

describe('cleanRuntimeArtifacts', () => {
  it('strips reveal and editor runtime state', () => {
    const el = parse('<section class="present" data-index-h="1" hidden><p class="fragment visible current-fragment" data-lid="3" contenteditable="true">x</p><span class="visible"></span></section>');
    cleanRuntimeArtifacts(el);
    expect(el.outerHTML).toBe('<section><p class="fragment">x</p><span></span></section>');
  });
  it('drops auto-assigned fragment indices but keeps explicit ones', () => {
    const el = parse('<div><p class="fragment" data-fragment-index="2" data-lec-auto-index="1">a</p><p class="fragment" data-fragment-index="1">b</p></div>');
    cleanRuntimeArtifacts(el);
    expect(el.innerHTML).toBe('<p class="fragment">a</p><p class="fragment" data-fragment-index="1">b</p>');
  });
});

describe('selection helpers', () => {
  it('decides selectability from display', () => {
    const img = parse('<img>');
    expect(isSelectableDisplay(img, 'inline')).toBe(true);
    const span = parse('<span></span>');
    expect(isSelectableDisplay(span, 'inline')).toBe(false);
    expect(isSelectableDisplay(span, 'inline-block')).toBe(true);
    const notes = parse('<aside class="notes"></aside>');
    expect(isSelectableDisplay(notes, 'block')).toBe(false);
  });
  it('climbs list items to the list and cells to the table', () => {
    const section = parse('<section><ul><li>a</li></ul><table><tbody><tr><td>x</td></tr></tbody></table><p>p</p></section>');
    const li = section.querySelector('li')!;
    expect(selectionTarget(li, section)).toBe(section.querySelector('ul'));
    const td = section.querySelector('td')!;
    expect(selectionTarget(td, section)).toBe(section.querySelector('table'));
    const p = section.querySelector('p')!;
    expect(selectionTarget(p, section)).toBe(p);
  });
});

describe('labels', () => {
  it('uses the first heading, truncated', () => {
    const s = parse('<section><div class="kicker">Intro</div><h2>' + 'x'.repeat(60) + '</h2></section>');
    expect(slideLabel(s, 'n')).toHaveLength(48);
    expect(slideLabel(parse('<section></section>'), 'Slide 3')).toBe('Slide 3');
  });
  it('detects stacks', () => {
    expect(isStack(parse('<section><section></section></section>'))).toBe(true);
    expect(isStack(parse('<section><p></p></section>'))).toBe(false);
  });
});
