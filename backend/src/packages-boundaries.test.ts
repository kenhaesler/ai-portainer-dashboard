import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ESLint } from 'eslint';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const CONFIG_FILE = 'eslint.packages.config.mjs';

/**
 * Architectural boundary gate for packages/ (#1585).
 *
 * The boundary rules that used to live in backend/eslint.config.js stopped
 * policing anything the moment the code moved out of backend/src into
 * packages/. Every element pattern still described the pre-monorepo layout
 * (src/core/**, src/routes/**, src/app.ts), so the rules matched zero files,
 * `boundaries/ignore` excluded the 37 test files that remained, and the Lint
 * job stayed green forever while enforcing nothing. Nobody noticed, because a
 * rule that matches no files and a rule that finds no violations are
 * indistinguishable from the exit code.
 *
 * This file exists so that cannot happen a second time. It does not re-implement
 * the rule table -- it drives the ACTUAL SHIPPING CONFIG through ESLint's Node
 * API and asserts that planted violations are reported. If someone edits
 * eslint.packages.config.mjs in a way that neuters the gate, these tests go red
 * even though `npm run lint` would still exit 0.
 *
 * Two failure directions are covered, and both matter:
 *   • forbidden edges must be REPORTED  (the gate can still fail)
 *   • allowed edges must be CLEAN       (the gate has not broken into reporting
 *                                        everything, which gets silenced fast)
 *
 * Deliberately NOT covered here, so this file is not mistaken for full
 * coverage:
 *   • the frontend/ and backend/ ESLint configs -- different configs, different
 *     rules; this file only drives eslint.packages.config.mjs
 *   • whether the real packages/ tree currently has violations -- that is what
 *     `npm run lint:packages` is for. These fixtures are virtual.
 *   • the CONTENT of the rule table beyond the directions exercised below. The
 *     full table lives in the config and in each package's src/CLAUDE.md.
 *   • whether "Lint" is a *required* status check in branch protection. That is
 *     a repo-settings concern outside this repo's files, and without it a red
 *     Lint job does not block a merge -- which is `continue-on-error` by
 *     another name. It cannot be verified from the working tree.
 */

// The gate is cwd-sensitive in TWO independent places, and vitest runs from
// backend/ rather than the repo root:
//
//   1. eslint-plugin-boundaries matches element patterns against a `rootPath`
//      that defaults to process.cwd() -- the directory ESLint was INVOKED from,
//      not the directory the config lives in, and NOT `new ESLint({ cwd })`.
//      From backend/, the repo-root-relative patterns match nothing and every
//      fixture degrades to an unknown file.
//   2. the resolver's `project: './tsconfig.eslint.json'` is likewise resolved
//      against the cwd. From backend/ the path map is never found, every
//      @dashboard/* import fails to resolve, and the edges stop being policed.
//
// So the tests below run with the cwd set to the repo root. That is not a
// workaround -- it is the documented precondition the real gate satisfies by
// running `lint:packages` from the root, and reproducing it is the whole point
// of testing the shipped config. The alternative (overriding the settings via
// overrideConfig) would mean asserting against a config that is not the one CI
// runs, which is the class of bug this file exists to prevent.
//
// backend runs with fileParallelism: false, so nothing else executes between
// these hooks; the cwd is restored afterwards regardless.
const originalCwd = process.cwd();
beforeAll(() => process.chdir(ROOT));
afterAll(() => process.chdir(originalCwd));

// One ESLint instance reused across every fixture: constructing it loads and
// resolves the flat config, which dominates the runtime. Reused, each lintText
// call lands in single-digit milliseconds, well inside vitest's 5s default.
const eslint = new ESLint({ cwd: ROOT, overrideConfigFile: CONFIG_FILE });

/**
 * Lints `code` as if it lived at `relativePath`. The file need not exist on
 * disk: eslint-plugin-boundaries classifies the LINTED file by pure string
 * matching on its path, and only its IMPORTS have to resolve -- and those are
 * real `@dashboard/*` specifiers going through the real tsconfig.eslint.json
 * path map. So these fixtures need no temp dirs and no cleanup, and they
 * exercise the shipped config rather than a copy of it.
 */
async function lintFixture(relativePath: string, code: string) {
  const results = await eslint.lintText(code, {
    filePath: resolve(ROOT, relativePath),
    warnIgnored: false,
  });
  return results.flatMap((r) => r.messages);
}

function importFixture(specifier: string): string {
  return `import { thing } from '${specifier}';\nexport const used = thing;\n`;
}

describe('packages/ boundary gate reports forbidden directions (#1585)', () => {
  // Each row is an edge the architecture forbids. `from` is where the fixture
  // file is placed (which decides its element type); `specifier` is the import
  // that must be rejected.
  const forbidden = [
    {
      name: 'core must not reach up into observability',
      path: 'packages/core/src/__boundary_fixture__.ts',
      specifier: '@dashboard/observability',
      fromType: 'core',
      toType: 'observability',
    },
    {
      name: 'ai is hard-isolated and must not reach security',
      path: 'packages/ai-intelligence/src/__boundary_fixture__.ts',
      specifier: '@dashboard/security',
      fromType: 'ai',
      toType: 'security',
    },
    {
      name: 'observability must not use the infrastructure sub-tier',
      path: 'packages/observability/src/__boundary_fixture__.ts',
      specifier: '@dashboard/infrastructure',
      fromType: 'observability',
      toType: 'infrastructure',
    },
    {
      name: 'infrastructure must not import the foundation aggregator',
      path: 'packages/infrastructure/src/__boundary_fixture__.ts',
      specifier: '@dashboard/foundation',
      fromType: 'infrastructure',
      toType: 'foundation',
    },
    {
      name: 'foundation must not reach operations (the deliberate 4-of-5 exclusion)',
      path: 'packages/foundation/src/__boundary_fixture__.ts',
      specifier: '@dashboard/operations',
      fromType: 'foundation',
      toType: 'operations',
    },
    {
      name: 'contracts is tier 0 and imports nothing, not even core',
      path: 'packages/contracts/src/__boundary_fixture__.ts',
      specifier: '@dashboard/core',
      fromType: 'contracts',
      toType: 'core',
    },
  ];

  for (const row of forbidden) {
    it(row.name, async () => {
      const messages = await lintFixture(row.path, importFixture(row.specifier));

      // A fixture with a syntax error produces a message with ruleId null, and
      // a test that accepted "some error" would pass on it while proving
      // nothing. Assert the rule that fired, by name.
      const errors = messages.filter((m) => m.severity === 2);
      expect(
        errors.map((m) => m.ruleId),
        `expected exactly one boundaries/dependencies error, got: ${JSON.stringify(messages)}`,
      ).toEqual(['boundaries/dependencies']);

      // And assert it is the RIGHT edge. Without this, a config that
      // misclassified every package as one blob would still pass.
      expect(errors[0].message).toContain(`"${row.fromType}"`);
      expect(errors[0].message).toContain(`"${row.toType}"`);
    });
  }

  it('a package barrel must not re-export from routes/', async () => {
    // An intra-package edge: index.ts and routes/ are both `observability`.
    // Same-element edges are skipped entirely unless `checkInternals: true` is
    // set on boundaries/dependencies, so this test is also the live proof that
    // the setting is still there and still doing something.
    const messages = await lintFixture(
      'packages/observability/src/index.ts',
      `export { collectMetrics } from './routes/metrics.js';\n`,
    );

    const errors = messages.filter((m) => m.severity === 2);
    expect(errors.map((m) => m.ruleId)).toEqual(['boundaries/dependencies']);
    expect(errors[0].message).toMatch(/barrel .* must not re-export from routes/);
  });

  it('a packages/ directory with no element descriptor is rejected outright', async () => {
    // The counter-intuitive half of the scheme. `default: 'disallow'` does NOT
    // cover a brand-new package: policies are only evaluated for files that
    // resolve to a KNOWN element, so an undeclared package's own files match no
    // policy and report nothing. boundaries/no-unknown-files is what closes it.
    const messages = await lintFixture(
      'packages/newpkg/src/thing.ts',
      importFixture('@dashboard/core'),
    );

    const errors = messages.filter((m) => m.severity === 2);
    expect(errors.map((m) => m.ruleId)).toEqual(['boundaries/no-unknown-files']);
  });
});

describe('packages/ boundary gate stays clean on allowed directions (#1585)', () => {
  // POSITIVE CONTROLS. Do not trim these as redundant.
  //
  // Every assertion above passes if the gate breaks into reporting EVERYTHING --
  // and a gate that flags legal imports gets disabled within a day, which is
  // the same silent-green outcome by a different route. These two tests are the
  // only thing standing between "the rules bite" and "the rules bite blindly".
  //
  // They also double as the proof that resolution works: the ai -> security row
  // above rejects the very same '@dashboard/security' specifier that this test
  // accepts from foundation. If the path map broke and the specifier resolved
  // to nothing, boundaries would classify it `external` and BOTH would be
  // clean -- so the two tests are only simultaneously satisfiable when
  // @dashboard/* genuinely resolves to package source.
  const allowed = [
    {
      name: 'foundation may import security',
      path: 'packages/foundation/src/__boundary_fixture__.ts',
      specifier: '@dashboard/security',
    },
    {
      name: 'security may import the sanctioned infrastructure sub-tier',
      path: 'packages/security/src/__boundary_fixture__.ts',
      specifier: '@dashboard/infrastructure',
    },
  ];

  for (const row of allowed) {
    it(row.name, async () => {
      const messages = await lintFixture(row.path, importFixture(row.specifier));
      // Zero messages, not zero errors: `lint:packages` runs with
      // --max-warnings=0, so a warning fails the gate exactly like an error.
      expect(messages, `expected no diagnostics, got: ${JSON.stringify(messages)}`).toEqual([]);
    });
  }
});

describe('packages/ boundary gate is wired into the lint script (#1585)', () => {
  const rootPkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf-8')) as {
    scripts?: Record<string, string>;
  };

  it('root `npm run lint` runs the packages gate', () => {
    // THE assertion that would have caught the original regression. For the
    // entire life of the packages/ restructure, root lint was
    //   lint:bash && lint -w backend && lint -w frontend
    // with packages/ linted by nothing at all. CI runs a bare `npm run lint`,
    // so a gate missing from this string is a gate that never executes.
    expect(rootPkg.scripts?.lint).toContain('lint:packages');
  });

  it('the packages gate script exists and cannot pass with warnings', () => {
    const script = rootPkg.scripts?.['lint:packages'];
    expect(script).toBeDefined();
    expect(script).toContain(CONFIG_FILE);
    // Raising this threshold is how a boundary error gets demoted to noise.
    expect(script).toContain('--max-warnings=0');
    // `|| true` / `; true` would make the gate advisory. Same escape hatch the
    // audit gate was neutered with (#1578).
    expect(script).not.toMatch(/\|\|\s*(true|exit\s+0)|;\s*true\s*$/);
  });
});

describe('packages/ boundary gate config has not been quietly weakened (#1585)', () => {
  // These assertions read the config THROUGH ESLint rather than as text, so
  // they see what the linter actually sees after flat-config merging -- a
  // later override block silently relaxing a rule would be caught here and
  // would not be caught by grepping the file.
  let config: Awaited<ReturnType<ESLint['calculateConfigForFile']>>;

  beforeAll(async () => {
    config = await eslint.calculateConfigForFile(resolve(ROOT, 'packages/core/src/x.ts'));
  });

  it('denies by default', () => {
    // `default: 'allow'` inverts the whole scheme: every edge becomes legal
    // unless explicitly disallowed, and the table below turns decorative.
    const [severity, options] = config.rules['boundaries/dependencies'] as [
      number,
      { default: string; checkInternals: boolean; policies: unknown[] },
    ];
    expect(severity).toBe(2);
    expect(options.default).toBe('disallow');
  });

  it('checks intra-package edges', () => {
    // LOAD-BEARING. checkInternals defaults to false, which skips edges between
    // files of the SAME element without evaluating them. The barrel rule is an
    // intra-package edge, so with this off it could never fire even once -- and
    // the config would still load, still lint, and still exit 0.
    const [, options] = config.rules['boundaries/dependencies'] as [
      number,
      { checkInternals: boolean },
    ];
    expect(options.checkInternals).toBe(true);
  });

  it('keeps the barrel policy last, where last-write-wins puts it in effect', () => {
    // Policies are last-write-wins. Every same-package self-allow above it
    // ('observability' -> 'observability', etc.) would otherwise permit a
    // barrel to re-export its own routes. Moving this row up is a one-line,
    // invisible way to delete the barrel rule.
    const [, options] = config.rules['boundaries/dependencies'] as [
      number,
      { policies: Array<Record<string, unknown>> },
    ];
    const last = options.policies[options.policies.length - 1];
    expect(last.from).toEqual({ file: { categories: 'barrel' } });
    expect(last.disallow).toEqual({ to: { file: { categories: 'route' } } });
  });

  it('keeps both unknown-element backstops enabled', () => {
    // They cover opposite directions of the same hole and neither substitutes
    // for the other: no-unknown-dependencies catches a known element importing
    // an undeclared one; no-unknown-files catches the undeclared package's own
    // files, which belong to no element and therefore match no policy.
    expect(config.rules['boundaries/no-unknown-dependencies']).toEqual([2]);
    expect(config.rules['boundaries/no-unknown-files']).toEqual([2]);
  });

  it('uses the v7 rule API, not the deprecated v6 spelling', () => {
    // Issue requirement #5. `boundaries/element-types` still exists in v7 but is
    // deprecated; mixing the two spellings is how half a rule table ends up
    // inert.
    const boundaryRules = Object.keys(config.rules).filter((r) => r.startsWith('boundaries/'));
    expect(boundaryRules).not.toContain('boundaries/element-types');
    expect(boundaryRules).toContain('boundaries/dependencies');
  });

  it('anchors every element descriptor instead of suffix-matching', () => {
    // partialMatch defaults to true, which matches a pattern against any SUFFIX
    // of a path -- so 'packages/core/src' would also claim
    // `<somewhere>/worktrees/x/packages/core/src/**`. `partialMatch: false` is
    // also the non-deprecated replacement for the old `mode: 'folder'`, which
    // now emits a plugin deprecation warning (and, under --max-warnings=0,
    // would fail the gate on unrelated runs).
    const elements = config.settings['boundaries/elements'] as Array<{
      type: string;
      pattern: string[];
      partialMatch?: boolean;
      mode?: string;
    }>;
    expect(elements.length).toBeGreaterThan(0);
    for (const element of elements) {
      expect(element.partialMatch, `element "${element.type}" is not anchored`).toBe(false);
      expect(element.mode, `element "${element.type}" uses the deprecated mode: descriptor`).toBeUndefined();
    }
  });
});

describe('packages/ boundary gate is independent of build state (#1585)', () => {
  // THE most important property in this file, and the least obvious.
  //
  // Every packages/*/package.json "exports" map points at ./dist, and dist/ is
  // gitignored. The CI Lint job runs `npm ci` and then `npm run lint` with NO
  // build step, so dist/ does not exist when the gate runs. An import that
  // fails to resolve is classified `external` by boundaries
  // (flagAsExternal.unresolvableAlias, default true) and is never
  // policy-checked -- so a dist-resolved config passes VACUOUSLY on exactly the
  // machine that matters. tsconfig.eslint.json is the fix, and these assertions
  // are what keep it correct.

  const packageDirs = readdirSync(resolve(ROOT, 'packages'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  /** Strips `//` comments from JSONC without eating `//` inside string values. */
  function parseJsonc(text: string): unknown {
    let out = '';
    let inString = false;
    for (let i = 0; i < text.length; i += 1) {
      const char = text[i];
      if (inString) {
        out += char;
        if (char === '\\') {
          out += text[i + 1] ?? '';
          i += 1;
        } else if (char === '"') {
          inString = false;
        }
        continue;
      }
      if (char === '"') {
        inString = true;
        out += char;
        continue;
      }
      if (char === '/' && text[i + 1] === '/') {
        while (i < text.length && text[i] !== '\n') i += 1;
        out += '\n';
        continue;
      }
      out += char;
    }
    return JSON.parse(out);
  }

  const tsconfigEslint = parseJsonc(
    readFileSync(resolve(ROOT, 'tsconfig.eslint.json'), 'utf-8'),
  ) as { compilerOptions?: { paths?: Record<string, string[]> } };
  const paths = tsconfigEslint.compilerOptions?.paths ?? {};

  it('the boundaries resolver points at the lint-only path map', async () => {
    // Repointing this at a package tsconfig, or dropping it entirely, sends
    // every @dashboard/* import back through the dist-based "exports" map.
    const config = await eslint.calculateConfigForFile(resolve(ROOT, 'packages/core/src/x.ts'));
    expect(config.settings['import/resolver']).toMatchObject({
      typescript: { project: './tsconfig.eslint.json' },
    });
  });

  it('maps every @dashboard/* specifier to package source, never to dist', () => {
    expect(Object.keys(paths).length).toBeGreaterThan(0);
    for (const [specifier, targets] of Object.entries(paths)) {
      expect(specifier.startsWith('@dashboard/'), `unexpected paths key ${specifier}`).toBe(true);
      for (const target of targets) {
        expect(target, `${specifier} does not point into packages/`).toMatch(/^packages\/[^/]+\/src/);
        expect(target, `${specifier} resolves through gitignored dist/`).not.toContain('dist');
      }
    }
  });

  it('covers every directory under packages/ in the path map', () => {
    // A 10th package added without a paths entry silently degrades to
    // "external" and stops being policed -- and nothing else catches that
    // omission, because the import still resolves at runtime through dist/.
    const mappedDirs = new Set(
      Object.values(paths).flatMap((targets) =>
        targets.map((target) => target.split('/')[1]),
      ),
    );
    expect([...mappedDirs].sort()).toEqual([...packageDirs].sort());

    // Both the bare and the subpath form, since the repo imports both
    // '@dashboard/core' and '@dashboard/core/plugins/auth.js'.
    for (const specifier of Object.keys(paths).filter((k) => !k.endsWith('/*'))) {
      expect(paths[`${specifier}/*`], `no subpath mapping for ${specifier}`).toBeDefined();
    }
  });

  it('covers every directory under packages/ with an element descriptor', async () => {
    // Same omission, other half: a package with no element descriptor is
    // caught at lint time by no-unknown-files, but only once someone happens to
    // lint it. Asserting the descriptor list matches the directory listing
    // turns that into a failure here, at the point the package is added.
    const config = await eslint.calculateConfigForFile(resolve(ROOT, 'packages/core/src/x.ts'));
    const elements = config.settings['boundaries/elements'] as Array<{ pattern: string[] }>;
    const describedDirs = new Set(
      elements.flatMap((element) => element.pattern.map((p) => p.split('/')[1])),
    );
    expect([...describedDirs].sort()).toEqual([...packageDirs].sort());
  });

  it('has no element pattern that depends on a build artifact', async () => {
    // An element pattern of `packages/core/dist` would match nothing on a clean
    // checkout -- the "rule that policices zero files" failure mode all over
    // again, one directory name away.
    const config = await eslint.calculateConfigForFile(resolve(ROOT, 'packages/core/src/x.ts'));
    const patterns = (
      config.settings['boundaries/elements'] as Array<{ pattern: string[] }>
    ).flatMap((element) => element.pattern);

    for (const pattern of patterns) {
      expect(pattern.split('/'), `element pattern "${pattern}" resolves through dist/`).not.toContain('dist');
    }
  });
});
