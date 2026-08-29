import { describe, expect, it } from 'vitest';
import { basename, dirname, isImagePath, joinPath, mimeFor, normalizePath, relativeTo, resolveRelative } from '../../src/workspace/Workspace';
import { MemoryWorkspace } from '../../src/workspace/memory';

describe('paths', () => {
  it('normalizes', () => {
    expect(normalizePath('./a/../b//c/')).toBe('b/c');
    expect(normalizePath('a\\b')).toBe('a/b');
  });
  it('dirname/basename/join', () => {
    expect(dirname('a/b/c.html')).toBe('a/b');
    expect(dirname('c.html')).toBe('');
    expect(basename('a/b/c.html')).toBe('c.html');
    expect(joinPath('a', '', 'b/c')).toBe('a/b/c');
  });
  it('resolves relative to the deck file', () => {
    expect(resolveRelative('talks/index.html', 'figures/a.png')).toBe('talks/figures/a.png');
    expect(resolveRelative('talks/index.html', '../shared/a.png')).toBe('shared/a.png');
    expect(resolveRelative('talks/index.html', 'https://x/y.png')).toBe('https://x/y.png');
    expect(resolveRelative('index.html', 'data:image/png;base64,xx')).toBe('data:image/png;base64,xx');
  });
  it('computes paths relative to the deck file', () => {
    expect(relativeTo('talks/index.html', 'talks/figures/a.png')).toBe('figures/a.png');
    expect(relativeTo('talks/index.html', 'shared/a.png')).toBe('../shared/a.png');
    expect(relativeTo('index.html', 'a.png')).toBe('a.png');
  });
  it('mime and image detection', () => {
    expect(mimeFor('a.PNG')).toBe('image/png');
    expect(mimeFor('x.unknown')).toBe('application/octet-stream');
    expect(isImagePath('a.svg')).toBe(true);
    expect(isImagePath('a.html')).toBe(false);
  });
});

describe('MemoryWorkspace', () => {
  it('stores, lists and reads files', async () => {
    const ws = new MemoryWorkspace('t', 'mem1');
    ws.addText('index.html', '<p>hi</p>');
    ws.addText('figures/a.txt', 'a');
    ws.addText('figures/sub/b.txt', 'b');
    expect(await ws.list('')).toEqual([{ name: 'figures', kind: 'directory' }, { name: 'index.html', kind: 'file' }]);
    expect(await ws.list('figures')).toEqual([{ name: 'a.txt', kind: 'file' }, { name: 'sub', kind: 'directory' }]);
    expect(await ws.readText('index.html')).toBe('<p>hi</p>');
    expect(await ws.exists('figures')).toBe(true);
    expect(await ws.exists('nope')).toBe(false);
    await expect(ws.readText('nope')).rejects.toThrow();
  });
});
