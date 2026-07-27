import { readFileSync, readdirSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * Typecheck gate for frontend test files (#1617).
 *
 * Third in the family that guards repo wiring by DRIVING the shipped config
 * rather than describing it: backend/src/ci-audit-gate.test.ts (#1578),
 * backend/src/packages-boundaries.test.ts (#1585),
 * backend/src/typecheck-gate.test.ts (#1586). It lives in frontend/src for the
 * same reason frontend/src/eslint-boundaries.test.ts does -- it is FRONTEND's
 * own config under test, and CLAUDE.md places frontend tests here.
 *
 * WHAT WENT WRONG. `frontend/tsconfig.json` carried
 * `"exclude": ["src/**\/*.test.ts", "src/**\/*.test.tsx"]` and
 * `frontend/package.json`'s typecheck script was a bare `tsc --noEmit`. There
 * was no second config adding the tests back, so not one of the 245 frontend
 * test files was typechecked by anything -- not `npm run typecheck`, not CI's
 * "Type Check" job. Two measured consequences: `ParsedLogEntry` literals in
 * log-viewer.test.ts were missing the required `levelSource` field and had
 * been for as long as the field existed, and
 * container-state-vocabulary.test.ts documented in prose that
 * `Record<ContainerState, ...>` made an unhandled state "a *compile* error,
 * caught by `npm run typecheck`" -- a guarantee that did not exist. Enabling
 * the files surfaced 2401 errors; 2289 were the config's own fault (untyped
 * jest-dom / vitest-axe matchers, unnamed @types/node) and 112 were real.
 *
 * WHAT THIS FILE ASSERTS. Not the individual errors fixed alongside it -- the
 * WIRING. A green `npm run typecheck` must keep meaning that every file vitest
 * will execute was also compiled. The assertion is deliberately phrased over
 * DISCOVERED test files rather than a hardcoded list or a reading of
 * `exclude`, because the failure to catch is the next file added under a path
 * some future `include` does not reach -- the same reason ci-audit-gate
 * discovers lockfiles instead of listing them.
 *
 * DELIBERATELY NOT ASSERTED:
 *   - That `tsconfig.json` keeps excluding tests. Splitting the browser
 *     program from the test program is one valid design (and the one in place:
 *     the browser program has no `types: ["node"]`, so a stray `process.env`
 *     in a component is still a compile error). Merging them is another. This
 *     gate should pass under either, so it checks COVERAGE, not layout.
 *   - Whether "Type Check" is a *required* status check in branch protection.
 *     A repo-settings concern outside this repo's files -- and without it a red
 *     job does not block a merge, which is `continue-on-error` by another name.
 */

const FRONTEND_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The `tsc` invocations `npm run typecheck -w frontend` actually performs. */
function parseTypecheckScript(script: string): { raw: string; configPath: string }[] {
  return script
    .split('&&')
    .map((segment) => segment.trim())
    .filter((segment) => /^(npx\s+)?tsc\b/.test(segment))
    .map((segment) => {
      // `-p X` / `--project X`; a bare `tsc` means ./tsconfig.json.
      const named = /(?:^|\s)(?:-p|--project)\s+(\S+)/.exec(segment);
      return {
        raw: segment,
        configPath: resolve(FRONTEND_DIR, named ? named[1] : 'tsconfig.json'),
      };
    });
}

/**
 * The file list a config really produces -- `extends` chain resolved, include
 * and exclude globs expanded against disk, by TypeScript itself. Reading
 * `exclude` out of the JSON would miss an exclusion that arrives through
 * `extends`, or an `include` that simply never reaches a directory.
 */
function programFiles(configPath: string): string[] {
  const host: ts.ParseConfigFileHost = {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
      throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
    },
  };
  const parsed = ts.getParsedCommandLineOfConfigFile(configPath, undefined, host);
  if (!parsed) throw new Error(`could not parse ${configPath}`);
  expect(parsed.errors.filter((e) => e.category === ts.DiagnosticCategory.Error)).toEqual([]);
  return parsed.fileNames.map((f) => resolve(f));
}

/** Every file vitest will execute, found on disk rather than listed here. */
function discoverTestFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && /\.test\.tsx?$/.test(entry.name))
    .map((entry) => resolve(entry.parentPath, entry.name));
}

const frontendPkg = JSON.parse(readFileSync(resolve(FRONTEND_DIR, 'package.json'), 'utf-8')) as {
  scripts?: Record<string, string>;
};
const typecheckScript = frontendPkg.scripts?.typecheck ?? '';
const invocations = parseTypecheckScript(typecheckScript);

describe('npm run typecheck -w frontend covers the test files (#1617)', () => {
  it('runs at least one tsc invocation', () => {
    expect(invocations.length).toBeGreaterThan(0);
  });

  it('every invocation is a --noEmit check, not a build', () => {
    for (const { raw } of invocations) {
      expect(raw, `"${raw}" would emit output`).toContain('--noEmit');
    }
  });

  it('does not swallow the exit code with a shell escape hatch', () => {
    // `|| true`, `|| exit 0`, `; true` are continue-on-error by other means --
    // the escape hatch that neutered the production audit gate (#1578).
    expect(typecheckScript).not.toMatch(/\|\|\s*(true|exit\s+0)|;\s*true\s*$/);
  });

  const covered = new Set(invocations.flatMap(({ configPath }) => programFiles(configPath)));
  const testFiles = discoverTestFiles(resolve(FRONTEND_DIR, 'src'));

  it('discovers the test files it is meant to be checking, so the assertion below is not vacuous', () => {
    // If a refactor moves the suite and this drops to zero, an empty `every`
    // would pass silently -- the same shape as `npm audit --offline` exiting 0
    // on an empty report.
    expect(testFiles.length).toBeGreaterThanOrEqual(200);
  });

  it('typechecks every frontend test file', () => {
    const uncovered = testFiles
      .filter((file) => !covered.has(file))
      .map((file) => relative(FRONTEND_DIR, file).split(sep).join('/'));

    expect(
      uncovered,
      `${uncovered.length} test file(s) are executed by vitest but compiled by nothing. ` +
        'Add them to a config that `npm run typecheck -w frontend` runs.',
    ).toEqual([]);
  });

  it('typechecks vitest.setup.ts, which is where the matcher types live', () => {
    // Not decorative. `toBeInTheDocument`, `toHaveAttribute` and
    // `toHaveNoViolations` are typed by `declare module 'vitest'` augmentations
    // that only apply while this file is IN the program. Drop it and 2241 of
    // the original 2401 errors come straight back -- as TS2339 on matchers
    // that do in fact exist, which reads like the tests are wrong.
    expect(covered.has(resolve(FRONTEND_DIR, 'vitest.setup.ts'))).toBe(true);
  });

  it('gives each incremental invocation its own tsBuildInfoFile', () => {
    // Two programs sharing one .tsbuildinfo make each run invalidate the
    // other's cache, and a stale hit can report a clean check for files the
    // current config never looked at.
    const buildInfoFiles = invocations
      .map(({ configPath }) => {
        const host: ts.ParseConfigFileHost = {
          ...ts.sys,
          onUnRecoverableConfigFileDiagnostic: () => {},
        };
        const parsed = ts.getParsedCommandLineOfConfigFile(configPath, undefined, host);
        return parsed?.options.incremental ? (parsed.options.tsBuildInfoFile ?? configPath) : null;
      })
      .filter((f): f is string => f !== null);

    expect(new Set(buildInfoFiles).size).toBe(buildInfoFiles.length);
  });
});

describe('the root typecheck script still reaches frontend (#1617)', () => {
  // Also asserted from the other side in backend/src/typecheck-gate.test.ts.
  // Both halves are needed and neither implies the other: this file proves the
  // frontend script covers the tests, that one proves the root script calls it.
  // Either alone permits a green `npm run typecheck` that checked nothing here.
  it('chains npm run typecheck -w frontend', () => {
    const rootPkg = JSON.parse(
      readFileSync(resolve(FRONTEND_DIR, '..', 'package.json'), 'utf-8'),
    ) as { scripts?: Record<string, string> };

    expect(rootPkg.scripts?.typecheck ?? '').toContain('npm run typecheck -w frontend');
  });
});
