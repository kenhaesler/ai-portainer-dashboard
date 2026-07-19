import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

/**
 * Boundary gate for frontend/ -> @dashboard/* imports (#1587).
 *
 * Sibling of backend/src/packages-boundaries.test.ts (#1585), which drives
 * eslint.packages.config.mjs the same way this file drives
 * frontend/eslint.config.js: through ESLint's Node API against virtual
 * fixtures, not by grepping config text. This file lives in frontend/src/
 * rather than next to the backend precedent because it is FRONTEND's own
 * config under test (CLAUDE.md's mandatory test-file rule already places
 * frontend tests at `frontend/src/**\/*.test.{ts,tsx}`), and because the cwd
 * this file needs to reproduce (frontend/, see below) is the cwd frontend's
 * own vitest suite already runs with -- unlike the backend precedent, which
 * has to `process.chdir()` away from backend/ to reach the repo root.
 *
 * Before this config existed, `npm run lint -w frontend` had zero
 * eslint-plugin-boundaries wiring: nothing stopped a frontend file from
 * importing @dashboard/core, a domain package, or @dashboard/server, which
 * would pull backend-only code (DB drivers, Fastify, node built-ins) into the
 * browser bundle. Today's real usage is 6 sites, all
 * `import type { ... } from '@dashboard/contracts'` -- this suite is what
 * keeps that true instead of relying on nobody adding a bad import.
 */

// This file, resolved from its own on-disk location rather than
// process.cwd(), so these constants are correct no matter which directory
// vitest happens to be invoked from.
const FRONTEND_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = resolve(FRONTEND_DIR, '..');
const CONFIG_FILE = resolve(FRONTEND_DIR, 'eslint.config.js');

/**
 * Builds an ESLint instance that lints as if invoked with the given cwd. The
 * config file path is always absolute, so only `cwd` varies between the two
 * instances used below -- that isolates the one variable this suite exists to
 * pin down (see the "invariant to invocation cwd" describe block).
 */
function makeLinter(cwd: string): ESLint {
  return new ESLint({ cwd, overrideConfigFile: CONFIG_FILE });
}

// The REAL invocation shape: root `npm run lint` runs `npm run lint -w
// frontend`, and `-w <workspace>` sets the child process's cwd to that
// workspace directory -- verified by actually running `npm run lint -w
// frontend` from the repo root and observing frontend/src fixtures resolve
// (or fail to resolve) exactly as they do here. A test that instead ran with
// cwd = repo root would not be exercising the config the way CI runs it, and
// would not have caught the false start this config had during development
// (see the "unknown"-vs-"unrelated-directory" test below).
const frontendLinter = makeLinter(FRONTEND_DIR);

async function lintFixture(linter: ESLint, relativePath: string, code: string) {
  const results = await linter.lintText(code, {
    filePath: resolve(FRONTEND_DIR, relativePath),
    warnIgnored: false,
  });
  return results.flatMap((r) => r.messages);
}

function importFixture(specifier: string): string {
  return `import { thing } from '${specifier}';\nexport const used = thing;\n`;
}

function typeImportFixture(specifier: string): string {
  return `import type { Thing } from '${specifier}';\nexport const used: Thing | undefined = undefined;\n`;
}

describe('frontend boundary gate reports forbidden directions (#1587)', () => {
  const forbidden = [
    // @dashboard/core is not a declared element in frontend/eslint.config.js
    // (frontend only knows about `frontend` and `contracts`), so the edge is
    // caught by the no-unknown-dependencies backstop, not by a `disallow`
    // policy naming `core` -- see the config's own header comment for why.
    { name: 'must not import @dashboard/core', specifier: '@dashboard/core' },
    { name: 'must not import a deep @dashboard/core subpath', specifier: '@dashboard/core/db/app-db.js' },
    { name: 'must not import @dashboard/server (composition root)', specifier: '@dashboard/server' },
    { name: 'must not import a domain package directly', specifier: '@dashboard/observability' },
  ];

  for (const row of forbidden) {
    it(row.name, async () => {
      const messages = await lintFixture(
        frontendLinter,
        'src/__boundary_fixture__.ts',
        importFixture(row.specifier),
      );
      const errors = messages.filter((m) => m.severity === 2);
      expect(
        errors.map((m) => m.ruleId),
        `expected exactly one boundaries/no-unknown-dependencies error, got: ${JSON.stringify(messages)}`,
      ).toEqual(['boundaries/no-unknown-dependencies']);
    });
  }
});

describe('frontend boundary gate stays clean on the allowed direction (#1587)', () => {
  it('a type-only @dashboard/contracts import is clean', async () => {
    const messages = await lintFixture(
      frontendLinter,
      'src/__boundary_fixture__.ts',
      typeImportFixture('@dashboard/contracts'),
    );
    expect(messages, `expected no diagnostics, got: ${JSON.stringify(messages)}`).toEqual([]);
  });

  it('a value @dashboard/contracts import is also clean (contracts is tier 0, pure schemas)', async () => {
    // The issue's "consider import-type-only enforcement" point was evaluated
    // and deliberately not added (see the config's own header comment) --
    // this test documents that decision as current, checked-in behavior
    // rather than leaving it unstated.
    const messages = await lintFixture(
      frontendLinter,
      'src/__boundary_fixture__.ts',
      importFixture('@dashboard/contracts'),
    );
    expect(messages).toEqual([]);
  });

  it('the 6 real existing @dashboard/contracts sites lint clean through this exact config', async () => {
    // Not synthetic fixtures: the actual files, read from disk, run through
    // the actual ESLint instance. This is the positive control -- it is only
    // meaningful together with the forbidden-imports tests above, because a
    // gate that reports nothing for ANYTHING would pass this trivially. The
    // "must not import @dashboard/core" tests are what rule that out.
    const realSites = [
      'src/features/ai-intelligence/hooks/use-investigations.ts',
      'src/features/ai-intelligence/hooks/use-monitoring.ts',
      'src/features/ai-intelligence/hooks/use-incidents.ts',
      'src/features/ai-intelligence/hooks/use-incident-insights.ts',
      'src/features/ai-intelligence/components/insight-card.tsx',
      'src/features/ai-intelligence/components/insight-card.test.tsx',
    ];

    for (const relativePath of realSites) {
      const absolutePath = resolve(FRONTEND_DIR, relativePath);
      const results = await frontendLinter.lintFiles([absolutePath]);
      const boundaryMessages = results
        .flatMap((r) => r.messages)
        .filter((m) => m.ruleId?.startsWith('boundaries/'));
      expect(
        boundaryMessages,
        `${relativePath} tripped the boundary gate: ${JSON.stringify(boundaryMessages)}`,
      ).toEqual([]);
    }
  });

  it('a same-workspace relative import outside src/ is clean (regression guard)', async () => {
    // MEASURED regression, not hypothetical: the first real
    // `npm run lint -w frontend` run against this config failed on
    // src/shared/lib/check-bundle-size.test.ts, which legitimately imports
    // ../../../scripts/check-bundle-size.ts. An earlier draft scoped the
    // `frontend` element to `frontend/src` only, which misclassified that
    // in-workspace relative import as `unknown` (a real on-disk file
    // matching no declared element) and tripped no-unknown-dependencies on
    // code that was never a boundary violation. The element pattern was
    // widened to cover the whole `frontend/` workspace to fix it -- this
    // test is what keeps that fix from quietly regressing.
    const messages = await lintFixture(
      frontendLinter,
      'src/shared/lib/__boundary_fixture__.ts',
      `import { checkBudgets } from '../../../scripts/check-bundle-size';\nexport const used = checkBudgets;\n`,
    );
    expect(messages).toEqual([]);
  });
});

describe('frontend boundary gate cwd behavior (#1587, the crux of this issue)', () => {
  // Two DIFFERENT cwd-dependence problems live in this config, and they have
  // different fixes -- conflating them was this suite's own first mistake
  // during development, corrected here rather than swept away:
  //
  //   1. `boundaries/root-path` and the resolver's `project` option default
  //      to being resolved against `process.cwd()`. This is the exact
  //      failure mode eslint.packages.config.mjs's header documents at
  //      length for packages/: a cwd-relative path here can silently
  //      misresolve @dashboard/* into gitignored dist/ or `external`, and
  //      the gate loads, lints, and exits 0 while checking nothing. FIXED
  //      here by pinning both to REPO_ROOT, an absolute path computed from
  //      this config file's own on-disk location -- proven below.
  //
  //   2. Separately, and NOT fixable the same way: ESLint's flat config
  //      resolves the `files: ['src/**/*.{ts,tsx}']` pattern a few lines
  //      down in eslint.config.js against the ESLint instance's cwd, not
  //      against any setting inside the config. That gates whether THIS
  //      WHOLE BLOCK (boundaries plugin, settings, rules) applies to a
  //      linted file at all -- pinning boundaries/root-path does not touch
  //      it. MEASURED: an absolute-path `files` pattern was tried and
  //      matches nothing under any cwd, so that is not an escape hatch
  //      either. This config therefore has the exact same real constraint
  //      eslint.packages.config.mjs documents for itself ("MUST run from the
  //      repo root") -- just for a different directory: this one MUST run
  //      with cwd = frontend/, which is exactly what `npm run lint -w
  //      frontend` guarantees (`-w <workspace>` sets the child process's cwd
  //      to that workspace directory). Proven below in both directions: the
  //      required cwd works, and the wrong cwd does NOT silently attach a
  //      neutered version of the rule -- it does not attach at all, which
  //      would itself be caught by any test lint run because the file
  //      currently under fixture would then be governed by no boundaries
  //      rule and fall through some OTHER `no-unknown-*` or unrelated
  //      failure rather than passing quietly.
  const repoRootLinter = makeLinter(REPO_ROOT);

  it('with the correct cwd (frontend/), a forbidden import is caught', async () => {
    const messages = await lintFixture(
      frontendLinter,
      'src/__boundary_fixture__.ts',
      importFixture('@dashboard/core'),
    );
    const errors = messages.filter((m) => m.severity === 2);
    expect(errors.map((m) => m.ruleId)).toEqual(['boundaries/no-unknown-dependencies']);
  });

  it('with the WRONG cwd (repo root), the boundaries block does not attach at all', async () => {
    // This is problem #2 above, made explicit rather than left as a trap:
    // this is not "the gate reports nothing wrong" (which would be
    // indistinguishable from a real pass) -- it is "the boundaries plugin,
    // and both of its rules, are absent from this file's calculated config",
    // which is a different and more diagnosable failure than a rule that
    // fires and finds nothing.
    const config = await repoRootLinter.calculateConfigForFile(
      resolve(FRONTEND_DIR, 'src/x.ts'),
    );
    const boundaryRuleNames = Object.keys(config?.rules ?? {}).filter((r) =>
      r.startsWith('boundaries/'),
    );
    expect(
      boundaryRuleNames,
      'expected the wrong cwd to detach the boundaries rules entirely, not merely stay quiet',
    ).toEqual([]);
  });

  it('the two settings historically responsible for #1585 are absolute, not cwd-relative strings', async () => {
    const config = await frontendLinter.calculateConfigForFile(
      resolve(FRONTEND_DIR, 'src/x.ts'),
    );
    const rootPath = config.settings['boundaries/root-path'] as string;
    const resolverProject = (
      config.settings['import/resolver'] as { typescript: { project: string } }
    ).typescript.project;

    expect(rootPath.startsWith('/'), `boundaries/root-path is not absolute: ${rootPath}`).toBe(
      true,
    );
    expect(rootPath).toBe(REPO_ROOT);
    expect(
      resolverProject.startsWith('/'),
      `resolver project path is not absolute: ${resolverProject}`,
    ).toBe(true);
    expect(resolverProject).toBe(resolve(REPO_ROOT, 'tsconfig.eslint.json'));
  });
});

describe('frontend boundary gate config has not been quietly weakened (#1587)', () => {
  it('denies by default, with exactly one allow policy (frontend -> contracts)', async () => {
    const config = await frontendLinter.calculateConfigForFile(resolve(FRONTEND_DIR, 'src/x.ts'));
    const [severity, options] = config.rules['boundaries/dependencies'] as [
      number,
      { default: string; checkInternals: boolean; policies: Array<Record<string, unknown>> },
    ];

    expect(severity).toBe(2);
    expect(options.default).toBe('disallow');
    expect(options.checkInternals).toBe(true);
    expect(options.policies).toHaveLength(1);
    expect(options.policies[0]).toEqual({
      from: { element: { type: 'frontend' } },
      allow: { to: { element: { types: ['frontend', 'contracts'] } } },
    });
  });

  it('keeps both unknown-element backstops enabled', async () => {
    const config = await frontendLinter.calculateConfigForFile(resolve(FRONTEND_DIR, 'src/x.ts'));
    expect(config.rules['boundaries/no-unknown-dependencies']).toEqual([2]);
    expect(config.rules['boundaries/no-unknown-files']).toEqual([2]);
  });

  it('uses the v7 rule API, not the deprecated v6 spelling', async () => {
    const config = await frontendLinter.calculateConfigForFile(resolve(FRONTEND_DIR, 'src/x.ts'));
    const boundaryRules = Object.keys(config.rules).filter((r) => r.startsWith('boundaries/'));
    expect(boundaryRules).not.toContain('boundaries/element-types');
    expect(boundaryRules).toContain('boundaries/dependencies');
  });

  it('anchors both element descriptors instead of suffix-matching', async () => {
    const config = await frontendLinter.calculateConfigForFile(resolve(FRONTEND_DIR, 'src/x.ts'));
    const elements = config.settings['boundaries/elements'] as Array<{
      type: string;
      pattern: string[];
      partialMatch?: boolean;
    }>;
    expect(elements.map((e) => e.type).sort()).toEqual(['contracts', 'frontend']);
    for (const element of elements) {
      expect(element.partialMatch, `element "${element.type}" is not anchored`).toBe(false);
    }
  });

  it('root `npm run lint` still reaches this config via `lint -w frontend`', () => {
    // The assertion that would catch a future restructure quietly routing
    // frontend/ lint somewhere else, mirroring the equivalent check in
    // backend/src/packages-boundaries.test.ts for lint:packages.
    const rootPkg = JSON.parse(readFileSync(resolve(REPO_ROOT, 'package.json'), 'utf-8')) as {
      scripts?: Record<string, string>;
    };
    expect(rootPkg.scripts?.lint).toContain('lint -w frontend');
  });

  it('frontend\'s own lint script still lints src/ with --max-warnings=0', () => {
    const frontendPkg = JSON.parse(readFileSync(resolve(FRONTEND_DIR, 'package.json'), 'utf-8')) as {
      scripts?: Record<string, string>;
    };
    const script = frontendPkg.scripts?.lint ?? '';
    expect(script).toContain('src/');
    // Raising this threshold, or dropping it, is how a boundary error gets
    // demoted from a failure to noise -- same escape hatch the audit gate
    // was neutered with once already (#1578).
    expect(script).toContain('--max-warnings=0');
  });
});
