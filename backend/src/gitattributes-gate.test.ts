import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');

/**
 * Line-ending policy gate (#1670). Without a root .gitattributes, a Windows
 * checkout with core.autocrlf=true materialises CRLF and byte-sensitive tests
 * (frontmatter regexes, CSV fixtures, docker-compose regexes) fail while Linux
 * CI stays green. Reads the file as the policy source of truth.
 */
describe('.gitattributes line-ending policy (#1670)', () => {
  const lines = readFileSync(resolve(ROOT, '.gitattributes'), 'utf-8')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));

  it('normalises all text files to LF in the working tree', () => {
    const catchAll = lines.find((l) => l.startsWith('* '));
    expect(catchAll).toBeDefined();
    expect(catchAll).toMatch(/\btext=auto\b/);
    expect(catchAll).toMatch(/\beol=lf\b/);
  });

  it('marks the binary types shipped in the repo as binary', () => {
    for (const ext of ['png', 'ico', 'woff2']) {
      expect(lines).toContain(`*.${ext} binary`);
    }
  });
});
