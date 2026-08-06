import { execFileSync } from 'node:child_process';
import { existsSync, globSync, readFileSync, readdirSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import vitestConfig from '../vitest.config';

const ROOT = resolve(__dirname, '../..');
const BACKEND_DIR = resolve(__dirname, '..');

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

  it('still typechecks backend', () => {
    // #1645. `backend` is a workspace like any other, and was the one this
    // chain forgot — see the describe block at the bottom of this file.
    expect(typecheckScript).toContain('npm run typecheck -w backend');
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

/**
 * Typecheck gate for backend's OWN test files (#1645).
 *
 * The third instance of one bug. #1586 found `packages/*` test files in no
 * program; #1617 found `frontend/`'s; this found `backend/`'s. Same two
 * ingredients each time: a `tsconfig.build.json` that excludes tests (correct
 * — they must not ship to `dist/`) and a root script that reaches the
 * workspace through nothing else.
 *
 * Backend's version was the barest of the three. `backend/tsconfig.json`
 * already included the tests (`include: ["src/**\/*"]`, excluding only
 * `node_modules`/`dist`/`tests`) and `backend/package.json` already had a
 * working `"typecheck": "tsc --noEmit"`. Both halves existed. The root script
 * simply never said `-w backend`, so the only path that reached the workspace
 * at all was `tsconfig.build.json`'s reference to `backend/tsconfig.build.json`
 * — which excludes `**\/*.test.ts`. Eight real errors sat behind that, all in
 * `security-regression-*.test.ts`: six dead config keys (`OLLAMA_BASE_URL`,
 * `OLLAMA_MODEL`, `LLM_OPENAI_ENDPOINT`, `LLM_BEARER_TOKEN`) passed to
 * `setConfigForTest(partial: Partial<EnvConfig>)` long after the schema
 * dropped them, and two implicitly-`any` plugin parameters. That is the suite
 * CLAUDE.md makes mandatory for every security fix.
 *
 * The assertion is COVERAGE, not layout, for the reason the frontend gate
 * gives: whether backend keeps one program or splits into two is a design
 * call, and this must pass under either. Both sides are DISCOVERED rather than
 * written down — the covered side by asking `tsc` to expand the configs the
 * script runs, the executed side by reading vitest's own `test.include` out of
 * `backend/vitest.config.ts` and globbing it. A hardcoded copy of either would
 * drift exactly the way the thing it guards did.
 *
 * Deliberately NOT asserted:
 *   • that `backend/tsconfig.json` keeps including tests — that is one way to
 *     satisfy coverage, not the only one, and asserting it would be asserting
 *     layout.
 *   • that `tsconfig.build.json` keeps excluding them. It should, but that is
 *     a packaging concern (`dist/` contents), not this gate's.
 */
describe('npm run typecheck -w backend covers the test files (#1645)', () => {
  const backendPkg = JSON.parse(readFileSync(resolve(BACKEND_DIR, 'package.json'), 'utf-8')) as {
    scripts?: Record<string, string>;
  };
  const backendTypecheck = backendPkg.scripts?.typecheck ?? '';

  /**
   * Backend pins TypeScript 7 — the native port, which ships no compiler API,
   * so `import ts from 'typescript'` yields a version stub rather than
   * `ts.sys`. Shelling out to the binary is therefore required, and is also
   * the more honest instrument: it is what the script itself runs, so a config
   * the CLI reads differently from the API cannot hide between them. Resolved
   * the way npm resolves `.bin` — backend's own copy, then the hoisted one.
   */
  const TSC = [
    resolve(BACKEND_DIR, 'node_modules/.bin/tsc'),
    resolve(BACKEND_DIR, '../node_modules/.bin/tsc'),
  ].find((candidate) => existsSync(candidate));

  /** The `tsc` invocations `npm run typecheck -w backend` actually performs. */
  const invocations = backendTypecheck
    .split('&&')
    .map((segment) => segment.trim())
    .filter((segment) => /^(npx\s+)?tsc\b/.test(segment))
    .map((segment) => {
      // `-p X` / `--project X`; a bare `tsc` means ./tsconfig.json.
      const named = /(?:^|\s)(?:-p|--project)\s+(\S+)/.exec(segment);
      return { raw: segment, configPath: resolve(BACKEND_DIR, named ? named[1] : 'tsconfig.json') };
    });

  /**
   * The file list a config really produces — `extends` chain resolved, globs
   * expanded against disk, by TypeScript itself. Reading `exclude` out of the
   * JSON would miss an exclusion arriving through `extends`, or an `include`
   * that simply never reaches a directory. `--listFilesOnly` builds the
   * program and stops before checking it, so this is fast.
   */
  function programFiles(configPath: string): string[] {
    if (!TSC) throw new Error('no tsc binary found in backend/ or the repo root');
    return execFileSync(TSC, ['--noEmit', '--listFilesOnly', '-p', configPath], {
      cwd: BACKEND_DIR,
      encoding: 'utf-8',
      maxBuffer: 64 * 1024 * 1024,
    })
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((file) => resolve(BACKEND_DIR, file));
  }

  const vitestOptions =
    (vitestConfig as { test?: { include?: string[] } }).test ?? {};

  const testFiles = globSync(vitestOptions.include ?? [], { cwd: BACKEND_DIR }).map((file) =>
    resolve(BACKEND_DIR, file),
  );

  it('runs at least one tsc invocation, and each is a check rather than a build', () => {
    expect(invocations.length).toBeGreaterThan(0);
    for (const { raw } of invocations) {
      expect(raw, `"${raw}" would emit output`).toContain('--noEmit');
    }
  });

  it('does not swallow the exit code with a shell escape hatch', () => {
    expect(backendTypecheck).not.toMatch(/\|\|\s*(true|exit\s+0)|;\s*true\s*$/);
  });

  it("reads vitest's own include patterns, so discovery cannot drift from execution", () => {
    // Not restated as a literal here on purpose — asserting equality with a
    // hardcoded copy would just move the drift. What must hold is that vitest
    // declares patterns and that they match real files on disk: an empty
    // `include`, or one globbing to nothing, would make the coverage assertion
    // below pass vacuously.
    expect(vitestOptions.include ?? []).not.toEqual([]);
    expect(testFiles.length).toBeGreaterThanOrEqual(25);
  });

  /**
   * Resolved on first use, not at collection time. `programFiles` shells out to
   * `tsc`, and a config it refuses to load throws — at collection that takes the
   * whole file down with an unattributed error, discarding the messages the
   * assertions below are written to produce. Memoized so the two consumers still
   * share one `tsc` run per config.
   */
  let coveredCache: Set<string> | undefined;
  const coveredFiles = () =>
    (coveredCache ??= new Set(invocations.flatMap(({ configPath }) => programFiles(configPath))));

  const rel = (file: string) => relative(BACKEND_DIR, file).split(sep).join('/');

  it('typechecks every file vitest will execute', () => {
    const covered = coveredFiles();
    const uncovered = testFiles.filter((file) => !covered.has(file)).map(rel);

    expect(
      uncovered,
      `${uncovered.length} test file(s) are executed by vitest but compiled by nothing. ` +
        'Add them to a config that `npm run typecheck -w backend` runs.',
    ).toEqual([]);
  });

  it('typechecks vitest.config.ts, which decides what runs at all', () => {
    // Its own gap, found while closing the other one. `rootDir: "src"` plus
    // `composite: true` on the typecheck program made a file outside src/
    // impossible to include, so this one was compiled by nothing — the same
    // shape that let a misplaced `configureServer` survive in frontend's vite
    // config until #1617. It is worth more than an ordinary config file here:
    // its `test.include` is what this gate reads to decide what "every test
    // file" means, so a type error in it degrades the gate itself.
    //
    // Discovered by glob rather than named, so a second root-level config does
    // not have to be remembered here.
    const configFiles = globSync('*.config.ts', { cwd: BACKEND_DIR }).map((file) =>
      resolve(BACKEND_DIR, file),
    );

    const covered = coveredFiles();
    expect(configFiles.length).toBeGreaterThan(0);
    expect(configFiles.filter((file) => !covered.has(file)).map(rel)).toEqual([]);
  });
});
