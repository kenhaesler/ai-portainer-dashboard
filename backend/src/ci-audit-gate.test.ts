import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

const ROOT = resolve(__dirname, '../..');

interface Step {
  name?: string;
  run?: string;
  'working-directory'?: string;
  'continue-on-error'?: boolean | string;
}

interface Workflow {
  jobs?: Record<string, { steps?: Step[] }>;
}

function readWorkflow(relativePath: string): Workflow {
  const content = readFileSync(resolve(ROOT, `.github/workflows/${relativePath}`), 'utf-8');
  return parseYaml(content) as Workflow;
}

/**
 * Lockfile integrity gate (#1578, narrowed by #1623).
 *
 * This job used to also run three `npm audit` steps (production high+,
 * critical, `loadtests` high+) enforcing a CVE gate. Removed in #1623: those
 * steps gate on the installed version of a package, not on whether this app's
 * code path can reach the vulnerable function, and with deliberately no
 * suppression allowlist the only way to clear a red one was an immediate
 * migration/override — which blocked every open Dependabot PR at once on
 * advisories that turned out unreachable here (#1618, #1621). `npm run
 * audit:prod` / `audit:all` / `audit:loadtests` remain as local, on-demand
 * scripts; nothing in CI enforces them anymore, and this file no longer
 * asserts anything about them.
 *
 * What's left is a different failure mode from a vulnerability: `npm ci`
 * installs a lockfile that omits a declared dependency without complaint, so
 * a tree that cannot fully install still goes green everywhere. Only
 * `npm ls --all` catches it (`@reduxjs/toolkit`'s missing
 * `@standard-schema/utils`, #1573).
 *
 * Deliberately NOT covered here:
 *   • Any CVE/vulnerability scanning — no longer enforced in CI at all
 *   • lockfile integrity of `loadtests/` — `npm ls` needs an installed tree and
 *     CI deliberately does not `npm ci` there
 *   • Docker base images, GitHub Action pins, non-npm toolchains
 *   • whether "Lockfile Integrity" is a *required* status check — that is a
 *     repo settings concern outside this repo's files. Without it a red job
 *     does not block a merge, which is `continue-on-error` by another name.
 */
describe('CI lockfile integrity gate (#1578, #1623)', () => {
  const wf = readWorkflow('ci.yml');
  const jobSteps = wf.jobs?.['lockfile-integrity']?.steps ?? [];
  const lockfileStep = jobSteps.find((s) => (s.run ?? '').includes('npm ls'));

  it('has a job that actually runs npm ls', () => {
    expect(jobSteps.length).toBeGreaterThan(0);
    expect(lockfileStep).toBeDefined();
  });

  it('does not let the lockfile-integrity step fail silently', () => {
    // The escape hatch that neutered the old production audit gate (#1578) —
    // guarded here for the check that remains.
    expect(
      lockfileStep?.['continue-on-error'],
      'lockfile-integrity step carries continue-on-error',
    ).toBeUndefined();
  });

  it('does not swallow the exit code with a shell escape hatch', () => {
    // `|| true`, `|| exit 0`, and `; true` are continue-on-error by other means.
    const run = lockfileStep?.run ?? '';
    expect(run, 'lockfile-integrity step swallows its exit code').not.toMatch(
      /\|\|\s*(true|exit\s+0)|;\s*true\s*$/,
    );
  });

  it('verifies the installed tree matches the lockfile, with --all', () => {
    // `npm ci` exits 0 on a lockfile that omits a dependency a package
    // declares, so the tree installs "successfully" while being incomplete —
    // that is how `@reduxjs/toolkit`'s `@standard-schema/utils` went missing
    // with every job green.
    //
    // `--all` is the load-bearing part. Bare `npm ls` validates only to depth 0
    // and exits 0 on exactly that tree — a silent no-op indistinguishable from
    // a clean result. Verified both ways against the pre-fix lockfile: with
    // `--all`, exit 1 naming the missing package; without it, exit 0.
    expect(lockfileStep, 'no lockfile integrity (npm ls) step found').toBeDefined();
    expect(lockfileStep!.run, 'npm ls without --all only checks depth 0').toMatch(
      /npm ls\b.*--all|--all.*\bnpm ls/,
    );
  });

  it('keeps the lockfile-integrity job outside the test-gate fan-in so it cannot be skipped', () => {
    // The job must not become a dependency of something that can be
    // conditionally skipped, which would let it be bypassed without editing
    // this file. It should stand alone.
    const job = wf.jobs?.['lockfile-integrity'] as { needs?: unknown } | undefined;
    expect(job).toBeDefined();
    expect(job?.needs).toBeUndefined();
  });
});
