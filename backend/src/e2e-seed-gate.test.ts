import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');

// e2e/ sits outside backend's tsconfig rootDir, so load the helper by URL
// rather than a static import (TS6059).
type Decide = (ci: string | undefined, detail: string) => { mode: 'fail' | 'skip'; message: string };
const { decideSeedFailure } = (await import(
  pathToFileURL(resolve(ROOT, 'e2e/helpers/seed-gate.ts')).href
)) as { decideSeedFailure: Decide };

/**
 * #1712: the remediation-approval e2e spec proves the observer-first approval
 * gate. A seeding failure used to `test.skip` both tests, so a broken seed
 * path became a green run. Under CI it must fail; only a local run without the
 * e2e stack may skip.
 */
describe('e2e seed-failure gate (#1712)', () => {
  it('fails (never skips) when CI is set', () => {
    for (const ci of ['true', '1', 'yes']) {
      const d = decideSeedFailure(ci, 'ECONNREFUSED');
      expect(d.mode).toBe('fail');
      expect(d.message).toContain('ECONNREFUSED');
    }
  });

  it('skips with an explicit reason locally', () => {
    for (const ci of [undefined, '', '0', 'false']) {
      const d = decideSeedFailure(ci, 'ECONNREFUSED');
      expect(d.mode).toBe('skip');
      expect(d.message).toMatch(/5442/);
    }
  });

  it('spec routes every seed failure through the gate and never skips unconditionally', () => {
    const src = readFileSync(resolve(ROOT, 'e2e/remediation-approval.spec.ts'), 'utf-8');
    expect(src).toContain('decideSeedFailure(process.env.CI');
    expect(src).toMatch(/throw new Error\(/);
    const skips = src.match(/test\.skip\([^)]*\)/g) ?? [];
    expect(skips.length).toBeGreaterThan(0);
    // Only the null-guard on a seeded action is allowed (null only occurs
    // locally, because trySeed throws under CI).
    for (const s of skips) expect(s).toMatch(/action === null/);
  });
});
