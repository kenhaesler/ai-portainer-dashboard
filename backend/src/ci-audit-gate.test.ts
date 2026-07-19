import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

const ROOT = resolve(__dirname, '../..');

/** Dirs that never hold a lockfile we ship, and are expensive to walk. */
const UNWALKED = new Set(['node_modules', 'dist', 'build', 'coverage']);

/**
 * Every `package-lock.json` in the repo, repo-relative.
 *
 * Deliberately discovered rather than hardcoded: the whole point is to notice
 * a lockfile nobody remembered to gate. A hardcoded list would be satisfied by
 * the two we already know about while a third sits unaudited.
 */
function findLockfiles(dir = ROOT, rel = ''): string[] {
  const found: string[] = [];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || UNWALKED.has(entry.name)) continue;
    const relPath = rel ? `${rel}/${entry.name}` : entry.name;

    if (entry.isDirectory()) found.push(...findLockfiles(resolve(dir, entry.name), relPath));
    else if (entry.name === 'package-lock.json') found.push(relPath);
  }

  return found;
}

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
 * Enforcing production audit gate (#1578).
 *
 * The `audit` job's high-severity production step used to carry
 * `continue-on-error: true`, so only `--audit-level=critical` could ever fail
 * the job. Nothing rated critical, so the job was permanently green while
 * `npm run audit:prod` exited 1 locally. Three separate High advisories reached
 * `dev` that way — undici (x3), nodemailer, and ws — each found by hand rather
 * than by CI.
 *
 * These assertions guard the wiring, not the advisories themselves. A green
 * audit job must mean the audit actually ran and actually passed.
 *
 * The same job also gates lockfile *integrity*, which is a different failure
 * mode from a vulnerability: `npm ci` installs a lockfile that omits a declared
 * dependency without complaint, so a tree that cannot fully install still goes
 * green everywhere. Only `npm ls --all` catches it.
 *
 * Deliberately NOT covered here, so this file is not mistaken for full
 * coverage:
 *   • devDependency Highs in the root tree (`audit:all` gates at critical only)
 *   • moderate advisories (root or loadtests)
 *   • lockfile integrity of `loadtests/` — `npm ls` needs an installed tree and
 *     CI deliberately does not `npm ci` there, so only its advisories are gated
 *   • Docker base images, GitHub Action pins, non-npm toolchains
 *   • whether "Security Audit" is a *required* status check — that is a repo
 *     settings concern outside this repo's files. Without it a red job does
 *     not block a merge, which is `continue-on-error` by another name.
 */
describe('CI production audit gate (#1578)', () => {
  const wf = readWorkflow('ci.yml');
  const auditSteps = wf.jobs?.audit?.steps ?? [];

  const auditRunSteps = auditSteps.filter((s) => (s.run ?? '').includes('npm audit'));
  const lockfileStep = auditSteps.find((s) => (s.run ?? '').includes('npm ls'));

  // Everything that can fail this job on a dependency problem. The escape-hatch
  // assertions below run over all of it — a `continue-on-error` on the lockfile
  // step disables that gate just as thoroughly as it did the audit one.
  const gateRunSteps = [...auditRunSteps, ...(lockfileStep ? [lockfileStep] : [])];

  it('has an audit job that actually runs npm audit', () => {
    expect(auditSteps.length).toBeGreaterThan(0);
    expect(auditRunSteps.length).toBeGreaterThan(0);
  });

  it('gates production dependencies at high severity', () => {
    const prodAudit = auditRunSteps.find((s) => (s.run ?? '').includes('--omit=dev'));

    expect(prodAudit, 'no production-only audit step found').toBeDefined();
    expect(prodAudit!.run).toContain('--audit-level=high');
  });

  it('does not let any dependency gate step fail silently', () => {
    // The whole point of #1578. `continue-on-error` on the high+ prod step is
    // what made three High advisories invisible.
    for (const step of gateRunSteps) {
      expect(
        step['continue-on-error'],
        `gate step "${step.name ?? step.run}" carries continue-on-error`,
      ).toBeUndefined();
    }
  });

  it('does not swallow the exit code with a shell escape hatch', () => {
    // `|| true`, `|| exit 0`, and `; true` are continue-on-error by other means.
    for (const step of gateRunSteps) {
      const run = step.run ?? '';
      expect(run, `gate step "${step.name}" swallows its exit code`).not.toMatch(
        /\|\|\s*(true|exit\s+0)|;\s*true\s*$/,
      );
    }
  });

  it('never runs the audit offline', () => {
    // `npm audit --offline` exits 0 with an empty report and no error field —
    // structurally identical to a clean audit. It is the one flag that turns
    // this gate into a silent no-op, so it is called out separately from the
    // generic escape-hatch check above.
    for (const step of auditRunSteps) {
      expect(step.run, `audit step "${step.name}" runs offline`).not.toMatch(
        /--offline|--prefer-offline/,
      );
    }
  });

  it('audits every lockfile in the repo, not just the ones we knew about', () => {
    // A root `npm audit` does not traverse a directory outside the workspace
    // graph. `loadtests/` is one, and that blind spot let a High (ws
    // GHSA-96hv-2xvq-fx4p) sit in `dev` with this job green — visible only as
    // a Dependabot alert. Discovering lockfiles rather than listing them means
    // the *next* out-of-graph lockfile fails here on the PR that adds it,
    // instead of relying on someone having read the warning in CLAUDE.md.
    const lockfiles = findLockfiles();

    // Guard against a broken walk silently making the loop below vacuous.
    expect(lockfiles).toContain('package-lock.json');
    expect(lockfiles).toContain('loadtests/package-lock.json');

    for (const lockfile of lockfiles) {
      const dir = dirname(lockfile); // '.' for the root lockfile
      const steps = auditRunSteps.filter((s) =>
        dir === '.' ? !s['working-directory'] : s['working-directory'] === dir,
      );

      expect(steps.length, `lockfile ${lockfile} has no npm audit step`).toBeGreaterThan(0);

      // The root tree splits its gate (production at high, everything at
      // critical). A lockfile outside it is dev tooling with no production
      // subset to carve out, so it gates high as a whole.
      if (dir !== '.') {
        expect(
          steps.some((s) => (s.run ?? '').includes('--audit-level=high')),
          `lockfile ${lockfile} is audited but not at high severity`,
        ).toBe(true);
      }
    }
  });

  it('verifies the installed tree matches the lockfile, with --all', () => {
    // `npm ci` exits 0 on a lockfile that omits a dependency a package
    // declares, so the tree installs "successfully" while being incomplete —
    // that is how `@reduxjs/toolkit`'s `@standard-schema/utils` went missing
    // with every job green. `npm audit` does not look at this either.
    //
    // `--all` is the load-bearing part. Bare `npm ls` validates only to depth 0
    // and exits 0 on exactly that tree — a silent no-op indistinguishable from
    // a clean result, the same trap as `npm audit --offline`. Verified both
    // ways against the pre-fix lockfile: with `--all`, exit 1 naming the
    // missing package; without it, exit 0.
    expect(lockfileStep, 'no lockfile integrity (npm ls) step found').toBeDefined();
    expect(lockfileStep!.run, 'npm ls without --all only checks depth 0').toMatch(
      /npm ls\b.*--all|--all.*\bnpm ls/,
    );
  });

  it('keeps the local audit:loadtests script in step with the CI gate', () => {
    // The script and the workflow step express the same gate two different
    // ways (`cd loadtests` vs `working-directory`), so they can drift. Only the
    // step is enforcing; a weakened script would quietly mislead anyone
    // checking locally before pushing.
    const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf-8')) as {
      scripts?: Record<string, string>;
    };
    const script = pkg.scripts?.['audit:loadtests'];

    expect(script, 'no audit:loadtests script in root package.json').toBeDefined();
    expect(script).toContain('--audit-level=high');
    expect(script).not.toMatch(/--offline|--prefer-offline|\|\|\s*(true|exit\s+0)/);
  });

  it('keeps the audit job outside the test-gate fan-in so it cannot be skipped', () => {
    // The audit job must not become a dependency of something that can be
    // conditionally skipped, which would let it be bypassed without editing
    // this file. It should stand alone.
    const audit = wf.jobs?.audit as { needs?: unknown } | undefined;
    expect(audit).toBeDefined();
    expect(audit?.needs).toBeUndefined();
  });
});
