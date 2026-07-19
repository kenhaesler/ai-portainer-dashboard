import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import boundaries from 'eslint-plugin-boundaries';

/**
 * ============================================================================
 * ARCHITECTURAL BOUNDARY GATE FOR packages/
 * ============================================================================
 *
 * This config is the enforcement mechanism for the layered package
 * architecture. It replaces the boundary rules that used to live in
 * backend/eslint.config.js, which silently stopped policing anything when the
 * code moved out of backend/src into packages/ (issue #1585): every element
 * pattern still described the old layout, so the rules matched zero files and
 * the job passed forever.
 *
 * Run from the REPOSITORY ROOT:
 *   npx eslint --config eslint.packages.config.mjs --max-warnings=0 \
 *     'packages/*<!---->/src/**<!---->/*.ts' 'packages/*<!---->/scripts/**<!---->/*.ts'
 *
 * ---------------------------------------------------------------------------
 * THE TWO LOAD-BEARING SETTINGS
 * ---------------------------------------------------------------------------
 * Two settings below look like fussy detail and are not. Remove either one and
 * the config still loads, still lints, and still EXITS 0 -- while enforcing
 * nothing. That is exactly how the previous boundary config rotted undetected.
 * Both claims were measured against a planted violation, not assumed; the
 * measurements are reproducible with the commands given.
 *
 *   [LOAD-BEARING #1] settings['import/resolver'].typescript.project
 *                     -> ./tsconfig.eslint.json
 *      Without that path map, @dashboard/* resolves through each package's
 *      "exports" map into dist/ -- gitignored, and absent on a fresh clone or a
 *      pre-build CI run. Removing it degrades the gate in two DIFFERENT ways
 *      depending on the import shape, and only one of them is noisy:
 *
 *        (a) a specifier that IS in the package's "exports" map resolves into
 *            dist/, which matches no element pattern, so the edge is reported
 *            as boundaries/no-unknown-dependencies. Wrong message, but loud.
 *        (b) a specifier that is NOT in the "exports" map fails to resolve at
 *            all, and an unresolvable non-relative specifier is classified
 *            `external` (flagAsExternal.unresolvableAlias, default true) and is
 *            never policy-checked. The violation disappears silently.
 *
 *      MEASURED, planting each import into packages/core/src/utils/network-security.ts
 *      with the `project` line deleted (observability's exports map is
 *      "." and "./routes/index.js" only):
 *        '@dashboard/observability'                              -> exit 1, 246 bytes,
 *                                                                   no-unknown-dependencies
 *        '@dashboard/observability/services/metrics-collector.js' -> exit 0, ZERO bytes
 *      Both are correctly reported as a core -> observability policy violation
 *      once the map is restored. Case (b) is the one that silently rots, and it
 *      covers every deep subpath import -- which is how core is imported 609
 *      times across this repo.
 *
 *   [LOAD-BEARING #2] checkInternals: true on boundaries/dependencies
 *      Defaults to false, meaning edges BETWEEN FILES OF THE SAME ELEMENT are
 *      skipped outright -- never evaluated against any policy. The
 *      barrel-must-not-re-export-routes policy is an intra-package edge, so
 *      without this it can never fire even once.
 *
 *      MEASURED: adding `export { default } from './routes/index.js'` to
 *      packages/infrastructure/src/index.ts gives
 *        checkInternals: true  -> exit 1, barrel policy message
 *        checkInternals: false -> exit 0, ZERO bytes of output.
 *
 * NOT load-bearing, but keep it anyway: `partialMatch: false` on the element
 * descriptors. Honesty matters more than a scary comment here -- flipping it to
 * true was measured to produce an IDENTICAL result on the current tree, because
 * the `files` glob already confines linting to packages/<dir>/src. It is kept
 * as defense in depth: partialMatch defaults to true, which matches a pattern
 * against any SUFFIX of a path, so 'packages/core/src' would also claim e.g.
 * `.claude/worktrees/<agent>/packages/core/src/**` if the `files` glob or the
 * invocation glob is ever widened. It is also the non-deprecated spelling of
 * the old mode: 'folder' (using `mode` emits a plugin deprecation warning).
 *
 * ---------------------------------------------------------------------------
 * OTHER THINGS THAT ARE EASY TO GET WRONG
 * ---------------------------------------------------------------------------
 * - Element patterns are resolved relative to `rootPath`, which is
 *   process.cwd() -- the directory ESLint was INVOKED from, not the directory
 *   this config file lives in. The patterns below are repo-root-relative, so
 *   the npm script MUST run from the repo root.
 *
 * - There is deliberately NO `boundaries/ignore` entry for test files. Tests
 *   were measured to add zero violations and they never widen the import graph.
 *   An over-broad ignore list is literally the mechanism that neutered the old
 *   backend config; do not reintroduce one to make a failure go away. If a test
 *   trips a boundary, the test is importing across a forbidden edge and that is
 *   the finding, not the noise.
 *
 * - Policies are LAST-WRITE-WINS. The barrel/route policy must stay LAST so it
 *   overrides the same-package self-allows above it.
 *
 * - v7 API: use `boundaries/dependencies` + `policies`. The v6
 *   `boundaries/element-types` + `rules` pair is deprecated, as are `mode`
 *   descriptors (`partialMatch` is the replacement for mode: 'folder'; a
 *   `boundaries/files` category descriptor is the replacement for mode: 'file').
 *   `{ element: {} }` throws "Invalid entity selector" -- use
 *   `{ element: { type: '*' } }` to mean "any element".
 */

// ---------------------------------------------------------------------------
// Element descriptors: one per package directory under packages/.
//
// `pattern` is an ARRAY covering both src/ and scripts/. scripts/ is not
// decorative: packages/ai-intelligence/src/__tests__/incidents-backfill.test.ts
// imports ../../scripts/backfill-incident-signatures.js. Drop the scripts entry
// and that file becomes the tree's only unknown dependency.
// ---------------------------------------------------------------------------
const packageElement = (type, dir) => ({
  type,
  pattern: [`packages/${dir}/src`, `packages/${dir}/scripts`],
  // Anchors the pattern to the full path from the invocation dir instead of
  // matching any path suffix. See the "NOT load-bearing" note in the header.
  partialMatch: false,
});

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ['**/dist/**', '**/node_modules/**'],
  },
  {
    files: ['packages/*/src/**/*.ts', 'packages/*/scripts/**/*.ts'],
    rules: {
      // Mirrors backend/eslint.config.js exactly. These relaxations are about
      // the pre-existing style debt in this codebase and say nothing about the
      // boundary rules below, which are NOT relaxable.
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-asserted-optional-chain': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      'prefer-const': 'off',
    },
  },
  {
    files: ['packages/*/src/**/*.ts', 'packages/*/scripts/**/*.ts'],
    plugins: { boundaries },
    settings: {
      'import/resolver': {
        typescript: {
          alwaysTryTypes: true,
          // [LOAD-BEARING #1] Points at the lint-only path map that redirects
          // @dashboard/* to package SOURCE instead of gitignored dist/.
          // Repointing this at a package tsconfig, or dropping it, makes every
          // cross-package import resolve as "external" and voids the gate.
          project: './tsconfig.eslint.json',
        },
      },

      // The architectural layers. Adding a packages/<dir> without adding it
      // here is caught by boundaries/no-unknown-dependencies.
      'boundaries/elements': [
        packageElement('contracts', 'contracts'),
        packageElement('core', 'core'),
        packageElement('infrastructure', 'infrastructure'),
        packageElement('observability', 'observability'),
        // Package name is @dashboard/ai; directory is ai-intelligence.
        packageElement('ai', 'ai-intelligence'),
        packageElement('security', 'security'),
        packageElement('operations', 'operations'),
        packageElement('foundation', 'foundation'),
        packageElement('server', 'server'),
      ],

      // File categories cut ACROSS elements: they classify a file by its role
      // inside whatever package it belongs to. This is what makes the barrel
      // rule expressible without a per-package policy.
      'boundaries/files': [
        // The public surface of a package.
        { category: 'barrel', pattern: 'packages/*/src/index.ts' },
        // HTTP route handlers -- an application-edge concern that must not
        // leak into a package's public API.
        { category: 'route', pattern: 'packages/*/src/routes/**/*.ts' },
      ],
    },
    rules: {
      'boundaries/dependencies': [
        'error',
        {
          // Deny by default: a new edge is forbidden until someone adds a
          // policy for it. Never flip this to 'allow'.
          default: 'disallow',

          // [LOAD-BEARING #2] Without this, same-element edges are skipped
          // entirely and the barrel policy below can never fire. Measured:
          // flipping this to false makes a planted barrel->route violation
          // exit 0 with zero output. See header.
          checkInternals: true,

          // ---------------------------------------------------------------
          // THE DEPENDENCY DIRECTION TABLE
          //
          // Read top to bottom as strictly widening tiers. A package may
          // import itself, its own tier, and anything strictly below it.
          //
          //   contracts        pure types, depends on nothing
          //   core             the kernel
          //   infrastructure   sanctioned SUB-TIER above core, below the
          //                    domain packages -- security/ and operations/
          //                    are documented consumers of it (see the
          //                    "Cross-domain Imports" section of each
          //                    package's src/CLAUDE.md). It is not a peer of
          //                    the domain packages.
          //   observability / ai / security / operations   domain packages
          //   foundation       composes the domain packages for the API layer
          //   server           composition root, may import everything
          //
          // Two entries are load-bearing ABSENCES:
          //   - `ai` may NOT reach observability, security, operations or
          //     infrastructure. The AI package is deliberately isolated to
          //     core + contracts so LLM code cannot acquire ambient access to
          //     infrastructure or security primitives.
          //   - `foundation` may NOT reach `operations`. This is intentional,
          //     not an oversight; do not "fix" it by adding operations here.
          //
          // Policies are evaluated LAST-WRITE-WINS.
          // ---------------------------------------------------------------
          policies: [
            {
              from: { element: { type: 'contracts' } },
              allow: { to: { element: { types: ['contracts'] } } },
            },
            {
              from: { element: { type: 'core' } },
              allow: { to: { element: { types: ['core', 'contracts'] } } },
            },
            {
              from: { element: { type: 'infrastructure' } },
              allow: {
                to: { element: { types: ['infrastructure', 'core', 'contracts'] } },
              },
            },
            {
              from: { element: { type: 'observability' } },
              allow: {
                to: { element: { types: ['observability', 'core', 'contracts'] } },
              },
            },
            {
              // Hard isolation. Do not widen without an explicit decision.
              from: { element: { type: 'ai' } },
              allow: { to: { element: { types: ['ai', 'core', 'contracts'] } } },
            },
            {
              from: { element: { type: 'security' } },
              allow: {
                to: {
                  element: {
                    types: ['security', 'infrastructure', 'core', 'contracts'],
                  },
                },
              },
            },
            {
              from: { element: { type: 'operations' } },
              allow: {
                to: {
                  element: {
                    types: ['operations', 'infrastructure', 'core', 'contracts'],
                  },
                },
              },
            },
            {
              // NOTE the deliberate omission of 'operations'.
              from: { element: { type: 'foundation' } },
              allow: {
                to: {
                  element: {
                    types: [
                      'foundation',
                      'ai',
                      'observability',
                      'security',
                      'infrastructure',
                      'core',
                      'contracts',
                    ],
                  },
                },
              },
            },
            {
              // Composition root: wires everything together, so it may import
              // everything. `{ element: {} }` throws; '*' is the any-element
              // spelling.
              from: { element: { type: 'server' } },
              allow: { to: { element: { type: '*' } } },
            },

            // MUST REMAIN LAST. Policies are last-write-wins, and every
            // self-allow above ('foundation' -> 'foundation', etc.) would
            // otherwise permit a barrel to re-export its own package's routes.
            //
            // A package barrel is its public API. Re-exporting routes/ from it
            // drags Fastify handlers, and transitively their whole dependency
            // fan-out, into every consumer of the package and turns the
            // route layer into an implicit part of the contract. Routes are
            // registered by the server, never imported through a barrel.
            {
              from: { file: { categories: 'barrel' } },
              disallow: { to: { file: { categories: 'route' } } },
              message:
                'A package barrel (src/index.ts) must not re-export from routes/. Routes are registered by the composition root, not exposed as package API.',
            },
          ],
        },
      ],

      // Backstops for the whole scheme. BOTH are required, and they cover
      // opposite directions of the same hole -- a packages/<dir> that nobody
      // added an element descriptor for. Neither one substitutes for the other.
      //
      //   no-unknown-dependencies catches a KNOWN element importing an unknown
      //   one (someone imports the new package).
      //
      //   no-unknown-files catches the new package's own files, which belong to
      //   NO element and therefore match NO policy -- `default: 'disallow'`
      //   does not save you here, because policies are only evaluated for files
      //   that resolve to a known element in the first place.
      //
      // MEASURED, because the asymmetry is genuinely counter-intuitive: a probe
      // file at packages/__probe_newpkg/src/thing.ts importing '@dashboard/core'
      // reports 0 problems with only no-unknown-dependencies enabled (the file
      // IS linted -- `--format json` confirms 1 file, 0 messages -- it simply
      // matches no policy), and errors with
      //   "File does not match any file pattern and does not belong to any
      //    known element"
      // once no-unknown-files is on. Deleting no-unknown-files therefore
      // restores exactly the silent-green failure this issue exists to kill.
      'boundaries/no-unknown-dependencies': 'error',
      'boundaries/no-unknown-files': 'error',
    },
  }
);
