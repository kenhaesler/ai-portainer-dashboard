import path from 'node:path';
import { fileURLToPath } from 'node:url';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import boundaries from 'eslint-plugin-boundaries';

/**
 * ============================================================================
 * BOUNDARY GATE FOR frontend/ -> @dashboard/* (issue #1587)
 * ============================================================================
 *
 * Sibling of the packages/ gate in eslint.packages.config.mjs (#1585). That
 * config polices imports BETWEEN packages/*; this one polices imports FROM
 * frontend/ INTO packages/*. Nothing stopped a frontend file from importing
 * @dashboard/core, a domain package, or @dashboard/server -- which would pull
 * backend code (DB drivers, Fastify, node-only APIs) and its whole dependency
 * fan-out into the browser bundle. Today's real usage is 6 sites, all
 * `import type { ... } from '@dashboard/contracts'` -- this makes that the
 * only legal edge instead of a convention nobody checks.
 *
 * ---------------------------------------------------------------------------
 * THE CWD GOTCHA (read this before touching REPO_ROOT below)
 * ---------------------------------------------------------------------------
 * eslint.packages.config.mjs's own header explains at length that
 * eslint-plugin-boundaries resolves `boundaries/elements` patterns, and the
 * eslint-import-resolver-typescript `project` option, against `process.cwd()`
 * -- the directory ESLint was INVOKED from, not the directory the config file
 * lives in. That config gets away with repo-root-relative patterns
 * (`packages/core/src`) because its npm script (`lint:packages`) invokes
 * `eslint` directly from the repo root.
 *
 * This config does NOT get that for free. The root `lint` script runs this
 * one via `npm run lint -w frontend`, and `-w <workspace>` sets the CHILD
 * PROCESS's cwd to that workspace directory (frontend/) -- verified by
 * printing `process.cwd()` from inside this file under that exact invocation.
 * A pattern like `packages/contracts/src`, correct for the packages/ gate,
 * would resolve to frontend/packages/contracts/src here: it doesn't exist, so
 * the edge would classify as `unknown` (or fail resolution and classify as
 * `external`) and the rule would never fire -- exactly the silent-green
 * failure #1585 already killed once, one directory rename away from
 * recurring.
 *
 * The fix here pins the two boundaries-specific settings absolutely instead
 * of writing patterns for one specific cwd. REPO_ROOT below is computed from
 * `import.meta.url` (this file's own on-disk location), which is invariant
 * to how or from where ESLint was launched. It is passed to two settings that
 * both accept an absolute value and, per their own source
 * (`eslint-plugin-boundaries`'s `getNormalizedRootPath` and
 * `eslint-import-resolver-typescript`'s `tryFile`, both of which no-op
 * `path.resolve`/`path.resolve`-equivalent logic against an already-absolute
 * input), use it verbatim instead of resolving it against cwd:
 *   - `settings['boundaries/root-path']` -- pins the base every
 *     `boundaries/elements` pattern below is matched against.
 *   - `settings['import/resolver'].typescript.project` -- pins the
 *     tsconfig.eslint.json path map (see that file's own header) so
 *     @dashboard/* still resolves to package source, not gitignored dist/,
 *     the same "load-bearing setting #1" the packages/ gate documents.
 *
 * IMPORTANT CAVEAT, MEASURED rather than assumed: this does NOT make the
 * whole config cwd-invariant, and it cannot -- the outer `files:
 * ['src/**\/*.{ts,tsx}']` a few lines down gates whether this config block
 * (boundaries plugin, settings, rules -- all of it) applies to a linted file
 * AT ALL, and ESLint's flat config resolves `files`/`ignores` patterns
 * against the ESLint instance's cwd, not the config file's location or any
 * setting inside it. Tested directly against this exact config: pointing
 * `overrideConfigFile` at this file's absolute path while constructing the
 * ESLint instance with `cwd` set to the repo root instead of frontend/ makes
 * `calculateConfigForFile` return NO boundaries rules for a frontend/src
 * file -- the block simply never attaches, silently. Absolute glob patterns
 * in `files:` were also tried and do not fix it (confirmed empirically: an
 * absolute-path `files` pattern matches nothing, under any cwd). So this
 * config has the exact same real constraint eslint.packages.config.mjs
 * documents for itself: it MUST be invoked with cwd = frontend/, which
 * `npm run lint -w frontend` guarantees (`-w <workspace>` sets the child
 * process's cwd to that workspace directory) and which
 * frontend/src/eslint-boundaries.test.ts reproduces and asserts, including a
 * dedicated check that the wrong cwd does NOT silently attach this block.
 * What pinning `boundaries/root-path` and the resolver `project` absolutely
 * DOES buy, given that one required cwd, is immunity from the OTHER failure
 * mode #1585 already hit once: a cwd-relative resolver path or element
 * pattern silently classifying every @dashboard/* import as `external`
 * (unresolvable) or resolving through gitignored dist/, so the gate loads,
 * lints, and exits 0 while checking nothing. See
 * frontend/src/eslint-boundaries.test.ts for both properties proven against
 * the real ESLint Node API, not just read off this file's source.
 *
 * ---------------------------------------------------------------------------
 * OTHER NOTES
 * ---------------------------------------------------------------------------
 * - `checkInternals: true` is irrelevant here (there is only one `frontend`
 *   element, so every intra-frontend edge would be self-to-self and allowed
 *   regardless), but it is set anyway for parity with eslint.packages.config.mjs
 *   and so a future third element does not silently inherit `false`.
 * - `boundaries/no-unknown-dependencies` is NOT decorative: `@dashboard/core`,
 *   `@dashboard/server`, etc. are not declared as elements here (frontend has
 *   no business naming tiers it must never touch), so an import of one of
 *   them resolves via tsconfig.eslint.json to a real file under packages/
 *   that matches neither the `frontend` nor the `contracts` element pattern.
 *   `boundaries/dependencies` only evaluates edges between two KNOWN elements
 *   -- an edge to an unmatched-but-resolved internal file is invisible to it,
 *   `default: 'disallow'` included. `no-unknown-dependencies` is the backstop
 *   that actually rejects it. (A plain third-party import like `react` is
 *   unaffected: it resolves into node_modules and is classified `external`
 *   automatically, never `unknown`.)
 * - No `import type`-only enforcement is added on top of this. All 6 existing
 *   `@dashboard/contracts` sites already use `import type`, and
 *   `@typescript-eslint/consistent-type-imports` (not currently enabled here)
 *   would be a repo-wide style rule, not a boundary rule -- out of scope for
 *   a value-vs-type-only gate on one specifier. A value import of
 *   `@dashboard/contracts` still passes this gate today; it produces pure
 *   Zod schema objects (tier 0, no backend deps), so nothing unsafe reaches
 *   the bundle either way. Revisit only if that stops being true.
 */
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ['dist/**', 'node_modules/**'],
  },
  {
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      // Relax rules for existing codebase
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'off',
      'react-refresh/only-export-components': 'off',
    },
  },
  {
    files: ['src/**/*.{ts,tsx}', 'scripts/**/*.ts', 'vitest.setup.ts', '*.config.ts'],
    plugins: { boundaries },
    settings: {
      'import/resolver': {
        typescript: {
          alwaysTryTypes: true,
          // Absolute -- see the CWD GOTCHA note above. Points at the same
          // lint-only path map the packages/ gate uses, so @dashboard/*
          // resolves to package source instead of gitignored dist/.
          project: path.join(REPO_ROOT, 'tsconfig.eslint.json'),
        },
      },
      // Absolute -- see the CWD GOTCHA note above. Every pattern in
      // `boundaries/elements` below is matched relative to this, not to
      // process.cwd().
      'boundaries/root-path': REPO_ROOT,
      // `frontend` covers the WHOLE frontend/ workspace, not just src/ --
      // src/ files legitimately import outside src/ (e.g.
      // src/shared/lib/check-bundle-size.test.ts imports
      // ../../../scripts/check-bundle-size.ts). Narrowing this to
      // `frontend/src` misclassifies that relative import as `unknown`
      // (a real on-disk file matching no element) and trips
      // no-unknown-dependencies on a legitimate same-workspace import --
      // measured, not hypothetical: that was this config's first failed
      // `npm run lint -w frontend` run. `files:` above and the CLI invocation
      // (`eslint --max-warnings=0 src/ scripts/ vitest.setup.ts
      // vite.config.ts vitest.config.ts`) are kept in step with each other --
      // a path the CLI lints but `files:` misses gets NONE of this block, and
      // `vitest.setup.ts` sat in exactly that hole until #1617: it is loaded
      // into all 246 test files and was linted by nothing, carrying two live
      // rule violations. `eslint-boundaries.test.ts` asserts both directions.
      // This element pattern additionally widens what an import TARGET may
      // resolve into and still count as an allowed same-element edge.
      'boundaries/elements': [
        { type: 'frontend', pattern: ['frontend'], partialMatch: false },
        { type: 'contracts', pattern: ['packages/contracts/src'], partialMatch: false },
      ],
    },
    rules: {
      'boundaries/dependencies': [
        'error',
        {
          // Deny by default: only the edge explicitly allowed below is legal.
          default: 'disallow',
          checkInternals: true,
          policies: [
            {
              from: { element: { type: 'frontend' } },
              allow: { to: { element: { types: ['frontend', 'contracts'] } } },
            },
          ],
        },
      ],
      // no-unknown-dependencies is load-bearing today -- see the "OTHER
      // NOTES" section above for why. no-unknown-files is NOT currently
      // load-bearing (the `frontend` element pattern above already covers
      // every path under `files:`, so every linted file matches it), but
      // costs nothing and is kept as defense in depth against a future edit
      // that narrows `frontend`'s pattern or widens `files:` -- mirroring
      // eslint.packages.config.mjs, which keeps the equivalent pair for the
      // same reason.
      'boundaries/no-unknown-dependencies': 'error',
      'boundaries/no-unknown-files': 'error',
    },
  }
);
