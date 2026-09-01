import { afterAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorkspaceHandler, isLoopbackHost, realInside, requestAllowed, safeJoin } from '../../cli/server.js';

describe('requestAllowed', () => {
  it('accepts loopback hosts with or without a port, and IPv6', () => {
    expect(requestAllowed({ host: '127.0.0.1:8791' })).toBeNull();
    expect(requestAllowed({ host: 'localhost' })).toBeNull();
    expect(requestAllowed({ host: 'LOCALHOST:5173' })).toBeNull();
    expect(requestAllowed({ host: '[::1]:8765' })).toBeNull();
  });
  it('refuses other hosts (DNS rebinding) and a missing Host', () => {
    expect(requestAllowed({ host: 'evil.example:8765' })).toMatch(/host .* not allowed/);
    expect(requestAllowed({ host: 'localhost.evil.example' })).toMatch(/not allowed/);
    expect(requestAllowed({})).toMatch(/not allowed/);
  });
  it('checks the Origin header against the same set', () => {
    expect(requestAllowed({ host: '127.0.0.1:8765', origin: 'http://127.0.0.1:8765' })).toBeNull();
    expect(requestAllowed({ host: '127.0.0.1:8765', origin: 'http://localhost:5173' })).toBeNull();
    expect(requestAllowed({ host: '127.0.0.1:8765', origin: 'http://evil.example' })).toMatch(/origin .* not allowed/);
    expect(requestAllowed({ host: '127.0.0.1:8765', origin: 'null' })).toMatch(/origin/);
  });
  it('allows the configured bind host, and any IP literal on a wildcard bind', () => {
    expect(requestAllowed({ host: '192.168.1.20:8765' }, '192.168.1.20')).toBeNull();
    expect(requestAllowed({ host: 'mymac.local:8765' }, '192.168.1.20')).toMatch(/not allowed/);
    expect(requestAllowed({ host: '192.168.1.20:8765' }, '0.0.0.0')).toBeNull();
    expect(requestAllowed({ host: 'evil.example:8765' }, '0.0.0.0')).toMatch(/not allowed/);
    expect(requestAllowed({ host: 'mymac.local:8765' }, 'mymac.local')).toBeNull();
  });
  it('isLoopbackHost', () => {
    expect(isLoopbackHost('127.0.0.1')).toBe(true);
    expect(isLoopbackHost('localhost')).toBe(true);
    expect(isLoopbackHost('0.0.0.0')).toBe(false);
  });
});

describe('safeJoin', () => {
  it('keeps paths inside the root', () => {
    expect(safeJoin('/deck', 'a/b.html')).toBe('/deck/a/b.html');
    expect(safeJoin('/deck', '/a/%20b.html')).toBe('/deck/a/ b.html');
    expect(safeJoin('/deck', '../x')).toBeNull();
    expect(safeJoin('/deck', 'a/../../x')).toBeNull();
  });
});

describe('realInside (symlinks)', () => {
  const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'lectern-server-')));
  const root = join(tmp, 'deck');
  const outside = join(tmp, 'outside');
  mkdirSync(join(root, 'figures'), { recursive: true });
  mkdirSync(outside);
  writeFileSync(join(outside, 'secret.txt'), 'shh');
  writeFileSync(join(root, 'index.html'), '<section></section>');
  symlinkSync(join(outside, 'secret.txt'), join(root, 'link.txt'));
  symlinkSync(outside, join(root, 'linkdir'));
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  it('accepts real files and folders inside the root', async () => {
    expect(await realInside(root, join(root, 'index.html'))).toBe(join(root, 'index.html'));
    expect(await realInside(root, root)).toBe(root);
  });
  it('accepts files that do not exist yet (new file, new nested folder)', async () => {
    expect(await realInside(root, join(root, 'figures', 'new.png'))).toBe(join(root, 'figures', 'new.png'));
    expect(await realInside(root, join(root, 'a', 'b', 'c.txt'))).toBe(join(root, 'a', 'b', 'c.txt'));
  });
  it('refuses a symlinked file, a symlinked folder and a new file below one', async () => {
    expect(await realInside(root, join(root, 'link.txt'))).toBeNull();
    expect(await realInside(root, join(root, 'linkdir'))).toBeNull();
    expect(await realInside(root, join(root, 'linkdir', 'new.txt'))).toBeNull();
  });

  it('the handler answers 403 for a symlink and still writes new files', async () => {
    type Handler = (req: unknown, res: unknown) => Promise<boolean>;
    const handle = createWorkspaceHandler(root) as unknown as Handler;
    const run = async (method: string, url: string, body = '') => {
      const chunks: Buffer[] = [];
      let status = 0;
      const listeners: Record<string, (c?: Buffer) => void> = {};
      const req = {
        method, url, headers: { host: '127.0.0.1:8765' },
        on(ev: string, fn: (c?: Buffer) => void) { listeners[ev] = fn; if (ev === 'end') { if (body) listeners.data?.(Buffer.from(body)); fn(); } },
      };
      let headers: Record<string, string> = {};
      const res = {
        writeHead(s: number, h?: Record<string, string>) { status = s; headers = h ?? {}; },
        end(b?: Buffer | string) { if (b) chunks.push(Buffer.from(b)); },
      };
      const handled = await handle(req, res);
      return { handled, status, headers, body: Buffer.concat(chunks).toString('utf8') };
    };
    expect((await run('GET', '/fs/local/index.html')).status).toBe(200);
    expect((await run('GET', '/fs/local/link.txt')).status).toBe(403);
    expect((await run('GET', '/fs/local/linkdir/secret.txt')).status).toBe(403);
    expect((await run('GET', '/api/list?path=linkdir')).status).toBe(403);
    // (the URL parser folds `..` in the path; the query string form reaches safeJoin's lexical check)
    expect((await run('GET', '/api/list?path=../outside')).status).toBe(400);
    expect((await run('PUT', '/fs/local/figures/new.svg', '<svg/>')).status).toBe(200);
    expect((await run('GET', '/fs/local/figures/new.svg')).body).toBe('<svg/>');
    expect((await run('PUT', '/fs/local/linkdir/evil.txt', 'x')).status).toBe(403);
    const refused = await run('GET', '/fs/local/index.html');
    expect(refused.handled).toBe(true);
    const rebinding = createWorkspaceHandler(root) as unknown as Handler;
    let status = 0;
    await rebinding({ method: 'GET', url: '/fs/local/index.html', headers: { host: 'evil.example' } }, { writeHead(s: number) { status = s; }, end() {} });
    expect(status).toBe(403);

    // Deck files are served to a browser: none of them may be sniffed into a script.
    expect((await run('GET', '/fs/local/index.html')).headers['X-Content-Type-Options']).toBe('nosniff');
    expect((await run('GET', '/api/workspace')).headers['X-Content-Type-Options']).toBe('nosniff');
    expect((await run('GET', '/fs/local/nope.html')).headers['X-Content-Type-Options']).toBe('nosniff');
  });
});
