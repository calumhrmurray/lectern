import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '..', '..');
const read = (p: string) => JSON.parse(readFileSync(resolve(root, p), 'utf8')) as { version: string };

describe('version', () => {
  it('package.json and the Claude Code plugin manifest carry the same version', () => {
    expect(read('plugins/lectern/.claude-plugin/plugin.json').version).toBe(read('package.json').version);
  });
});
