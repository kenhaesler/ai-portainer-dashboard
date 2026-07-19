import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');

/**
 * Guards the root `typecheck` script wiring (#1586).
 *
 * Every package under packages/ already had its own non-build `tsconfig.json`
 * (no `**\/*.test.ts` / `**\/__tests__/**` exclusion) and its own
 * `"typecheck": "tsc --noEmit"` npm script — both existed and worked in
 * isolation. But the root `typecheck` script only ever ran
 * `tsc --build tsconfig.build.json`, which builds `tsconfig.build.json` — and
 * EVERY `packages/*\/tsconfig.build.json` excludes test files (correctly:
 * tests must not ship to `dist/`). Nothing else ever invoked the per-package
 * script, so 49 type errors across 5 packages were invisible to
 * `npm run typecheck` and to CI's "Type Check" job (`.github/workflows/ci.yml`,
 * job `typecheck`), which just runs `npm run typecheck`.
 *
 * These assertions guard the WIRING, not the individual errors fixed
 * alongside it. A green `npm run typecheck` must mean every package's test
 * files were actually typechecked, not just its shipped `src/`.
 *
 * Deliberately NOT covered here:
 *   • the CONTENT of any package's `tsconfig.json` beyond the test-exclusion
 *     check below — only that tests are in scope, not e.g. strict mode.
 *   • whether "Type Check" is a *required* status check in branch protection
 *     — a repo-settings concern outside this repo's files, and without it a
 *     red job does not block a merge (`continue-on-error` by another name).
 */
describe('root typecheck wiring covers packages/ tests (#1586)', () => {
  const rootPkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf-8')) as {
    scripts?: Record<string, string>;
  };
  const typecheckScript = rootPkg.scripts?.typecheck ?? '';

  // Discovered, not hardcoded — the whole point is to catch the NEXT package
  // added without typecheck wiring, not just the 9 that exist today. A
  // hardcoded list would be satisfied by the ones we already know about while
  // a 10th sits unchecked, same failure mode ci-audit-gate.test.ts guards
  // against for lockfiles.
  const packageDirs = readdirSync(resolve(ROOT, 'packages'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  const packages = packageDirs.map((dir) => {
    const pkg = JSON.parse(
      readFileSync(resolve(ROOT, 'packages', dir, 'package.json'), 'utf-8'),
    ) as { name: string; scripts?: Record<string, string> };
    return { dir, name: pkg.name, typecheckScript: pkg.scripts?.typecheck };
  });

  it('discovers at least the known packages, so the loop below is not vacuous', () => {
    expect(packageDirs.length).toBeGreaterThanOrEqual(9);
  });

  it('still builds the production tsconfig graph first', () => {
    // The composite build is still useful on its own: it validates project
    // references and the cross-package build graph, which the per-package
    // `tsc --noEmit` runs below (each scoped to its own standalone
    // tsconfig.json) do not exercise.
    expect(typecheckScript).toContain('tsc --build tsconfig.build.json');
  });

  it('still typechecks frontend', () => {
    expect(typecheckScript).toContain('npm run typecheck -w frontend');
  });

  it.each(packages.map((p) => [p.dir, p.name, p.typecheckScript] as const))(
    'root typecheck runs %s (%s) own typecheck script, which itself runs tsc --noEmit',
    (dir, name, pkgScript) => {
      // Half A: the root script actually references this package's workspace.
      expect(
        typecheckScript,
        `root "typecheck" script does not invoke "npm run typecheck -w ${name}"`,
      ).toContain(`npm run typecheck -w ${name}`);

      // Half B: that reference points at something real. A correct reference
      // to a gutted/renamed script (e.g. downgraded to `echo skip`) would
      // pass Half A while checking nothing — same class of silent-pass this
      // file exists to prevent.
      expect(pkgScript, `packages/${dir}/package.json has no "typecheck" script`).toBeDefined();
      expect(pkgScript).toContain('tsc');
      expect(pkgScript).toContain('--noEmit');
    },
  );

  it('does not swallow the exit code with a shell escape hatch', () => {
    // `|| true`, `|| exit 0`, `; true` are continue-on-error by other means —
    // the same escape hatch that neutered the production audit gate (#1578).
    expect(typecheckScript).not.toMatch(/\|\|\s*(true|exit\s+0)|;\s*true\s*$/);
  });
});

describe("per-package tsconfig.json doesn't exclude the tests it's meant to cover (#1586)", () => {
  const packageDirs = readdirSync(resolve(ROOT, 'packages'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  it.each(packageDirs)('packages/%s/tsconfig.json does not exclude test files', (dir) => {
    const tsconfigPath = resolve(ROOT, 'packages', dir, 'tsconfig.json');
    const tsconfig = JSON.parse(readFileSync(tsconfigPath, 'utf-8')) as {
      exclude?: string[];
    };

    // tsconfig.build.json correctly excludes tests so they never ship to
    // dist/. The PLAIN tsconfig.json — the one `npm run typecheck -w <pkg>`
    // actually drives — must NOT carry the same exclusion, or the wiring
    // asserted above would run a typecheck that still sees zero test files:
    // green for the wrong reason, indistinguishable from the original bug.
    for (const pattern of tsconfig.exclude ?? []) {
      expect(
        pattern,
        `packages/${dir}/tsconfig.json excludes "${pattern}" — its tests would be invisible again`,
      ).not.toMatch(/\.test\.ts|__tests__/);
    }
  });
});
