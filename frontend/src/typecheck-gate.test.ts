import { execFileSync } from 'node:child_process';
import { existsSync, globSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import vitestConfig from '../vitest.config';

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
 * was no second config adding the tests back, so not one of the 246 frontend
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
 * The same gap covered `vite.config.ts` and `vitest.config.ts`, reachable only
 * through `tsconfig.json`'s `references` -- which a plain `tsc -p` does not
 * follow, and no script here runs `tsc -b`. It was hiding a live bug:
 * `configureServer`, a PLUGIN hook, sat under `server:`, where vite silently
 * ignores unknown keys, so the `/__commit` middleware never registered and the
 * dev-only build-ref fetch in header.tsx had never once succeeded.
 *
 * WHAT THIS FILE ASSERTS. Not the individual errors fixed alongside it -- the
 * WIRING. A green `npm run typecheck` must keep meaning that every file vitest
 * will execute was also compiled. Both sides of that claim are DISCOVERED
 * rather than written down: the covered side by asking `tsc` to expand each
 * config in the script, and the executed side by reading vitest's OWN
 * `test.include` out of `vitest.config.ts` and globbing it. A hardcoded list,
 * or a hardcoded copy of vitest's glob, would drift the moment vitest's
 * `include` changed -- the exact failure mode this gate exists to catch, one
 * level up. (That import also makes `vitest.config.ts`'s own type-health
 * load-bearing here, which is a second reason the config files are asserted to
 * be in a program below.)
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

/**
 * `defineConfig` is overloaded and its declared return type admits a callback
 * and a promise, neither of which the object-literal call in vitest.config.ts
 * can produce. Narrowed once, here, to the two fields this gate reads.
 */
const vitestOptions = (vitestConfig as { test?: { include?: string[]; setupFiles?: string[] } }).test ?? {};

/**
 * The same `tsc` the typecheck script gets — frontend's own copy, falling back
 * to the hoisted one, exactly as npm resolves `.bin`.
 *
 * This gate asks `tsc` itself what a config expands to instead of importing the
 * compiler API (`ts.getParsedCommandLineOfConfigFile`) because **TypeScript 7,
 * which this workspace pins, is the native port and ships no compiler API** —
 * `import ts from 'typescript'` there yields a version stub, not `ts.sys`. The
 * CLI is also the more honest instrument for this particular gate: it is the
 * binary the script actually runs, so a config the CLI reads differently from
 * the API cannot hide between them.
 */
const TSC = [
  resolve(FRONTEND_DIR, 'node_modules/.bin/tsc'),
  resolve(FRONTEND_DIR, '../node_modules/.bin/tsc'),
].find((candidate) => existsSync(candidate));

function runTsc(args: string[]): string {
  if (!TSC) throw new Error('no tsc binary found in frontend/ or the repo root');
  // Throws on a non-zero exit, which is what a config that does not parse
  // produces — the same failure the API version surfaced via `parsed.errors`.
  return execFileSync(TSC, args, { cwd: FRONTEND_DIR, encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 });
}

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
 *
 * `--listFilesOnly` builds the program and stops before typechecking it, so
 * this costs ~0.2s per config rather than a full check.
 */
function programFiles(configPath: string): string[] {
  return runTsc(['--noEmit', '--listFilesOnly', '-p', configPath])
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((file) => resolve(FRONTEND_DIR, file));
}

/** A config's fully-resolved compilerOptions, `extends` chain applied. */
function resolvedOptions(configPath: string): Record<string, unknown> {
  const shown = JSON.parse(runTsc(['--showConfig', '-p', configPath])) as {
    compilerOptions?: Record<string, unknown>;
  };
  return shown.compilerOptions ?? {};
}

/** Absolute paths for a set of workspace-relative globs. */
function expand(patterns: string[]): string[] {
  return globSync(patterns, { cwd: FRONTEND_DIR }).map((file) => resolve(FRONTEND_DIR, file));
}

function rel(file: string): string {
  return relative(FRONTEND_DIR, file).split(sep).join('/');
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
  const testFiles = expand(vitestOptions.include ?? []);

  it('reads vitest\'s own include patterns, so discovery cannot drift from execution', () => {
    // The patterns are not restated here on purpose -- asserting they equal a
    // literal would just move the drift. What must hold is that vitest declares
    // some, and that they match real files: an empty `include`, or one whose
    // glob matches nothing, would make the coverage assertion below pass
    // vacuously -- the same shape as `npm audit --offline` exiting 0 on an
    // empty report.
    expect(vitestOptions.include ?? []).not.toEqual([]);
    expect(testFiles.length).toBeGreaterThanOrEqual(200);
  });

  it('typechecks every file vitest will execute', () => {
    const uncovered = testFiles.filter((file) => !covered.has(file)).map(rel);

    expect(
      uncovered,
      `${uncovered.length} test file(s) are executed by vitest but compiled by nothing. ` +
        'Add them to a config that `npm run typecheck -w frontend` runs.',
    ).toEqual([]);
  });

  it('typechecks vitest\'s setup files, which is where the matcher types live', () => {
    // Not decorative. `toBeInTheDocument`, `toHaveAttribute` and
    // `toHaveNoViolations` are typed by `declare module 'vitest'` augmentations
    // that only apply while the setup file is IN the program. Drop it and 2241
    // of the original 2401 errors come straight back -- as TS2339 on matchers
    // that do in fact exist, which reads like the tests are wrong. Read from
    // vitest's `setupFiles` rather than named, for the same reason `include` is.
    const setupFiles = expand(vitestOptions.setupFiles ?? []);
    expect(setupFiles.length).toBeGreaterThan(0);
    expect(setupFiles.filter((file) => !covered.has(file)).map(rel)).toEqual([]);
  });

  it('typechecks the build-tooling configs vite and vitest load at startup', () => {
    // `vite.config.ts` and `vitest.config.ts` were in no program until #1617 --
    // `tsconfig.json` names tsconfig.node.json under `references`, which a
    // plain `tsc -p` does not follow. That hid a misplaced `configureServer`
    // for the life of the file. Discovered by glob, not listed, so a third
    // root config does not have to be remembered here.
    //
    // Note this file's own `import ... from '../vitest.config'` drags
    // vitest.config.ts into the test program transitively, so that one would
    // read as covered even if tsconfig.node.json left the script. vite.config.ts
    // has no such importer and is the load-bearing half of this assertion —
    // confirmed by mutation: dropping the node config fails this test.
    const configFiles = expand(['*.config.ts']);
    expect(configFiles.length).toBeGreaterThan(0);
    expect(configFiles.filter((file) => !covered.has(file)).map(rel)).toEqual([]);
  });

  it('gives each incremental invocation its own tsBuildInfoFile', () => {
    // Two programs sharing one .tsbuildinfo make each run invalidate the
    // other's cache, and a stale hit can report a clean check for files the
    // current config never looked at.
    const buildInfoFiles = invocations
      .map(({ configPath }) => {
        const options = resolvedOptions(configPath);
        if (!options.incremental && !options.composite) return null;
        const declared = options.tsBuildInfoFile;
        // An incremental config with no explicit path derives one from the
        // config's own location, so the config path stands in for it.
        return typeof declared === 'string' ? resolve(FRONTEND_DIR, declared) : configPath;
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
