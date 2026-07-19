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
 * Deliberately NOT covered here, so this file is not mistaken for full
 * coverage:
 *   • devDependency Highs in the root tree (`audit:all` gates at critical only)
 *   • moderate advisories (root or loadtests)
 *   • Docker base images, GitHub Action pins, non-npm toolchains
 *   • whether "Security Audit" is a *required* status check — that is a repo
 *     settings concern outside this repo's files. Without it a red job does
 *     not block a merge, which is `continue-on-error` by another name.
 */
describe('CI production audit gate (#1578)', () => {
  const wf = readWorkflow('ci.yml');
  const auditSteps = wf.jobs?.audit?.steps ?? [];

  const auditRunSteps = auditSteps.filter((s) => (s.run ?? '').includes('npm audit'));

  it('has an audit job that actually runs npm audit', () => {
    expect(auditSteps.length).toBeGreaterThan(0);
    expect(auditRunSteps.length).toBeGreaterThan(0);
  });

  it('gates production dependencies at high severity', () => {
    const prodAudit = auditRunSteps.find((s) => (s.run ?? '').includes('--omit=dev'));

    expect(prodAudit, 'no production-only audit step found').toBeDefined();
    expect(prodAudit!.run).toContain('--audit-level=high');
  });

  it('does not let any npm audit step fail silently', () => {
    // The whole point of #1578. `continue-on-error` on the high+ prod step is
    // what made three High advisories invisible.
    for (const step of auditRunSteps) {
      expect(
        step['continue-on-error'],
        `audit step "${step.name ?? step.run}" carries continue-on-error`,
      ).toBeUndefined();
    }
  });

  it('does not swallow the exit code with a shell escape hatch', () => {
    // `|| true`, `|| exit 0`, and `; true` are continue-on-error by other means.
    for (const step of auditRunSteps) {
      const run = step.run ?? '';
      expect(run, `audit step "${step.name}" swallows its exit code`).not.toMatch(
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

  it('audits the loadtests lockfile, which no root audit can reach', () => {
    // `loadtests/` is not an npm workspace and has its own lockfile, so the
    // two root steps above do not traverse it. That blind spot let a High
    // (ws GHSA-96hv-2xvq-fx4p) sit in `dev` with this job green — it was
    // visible only as a Dependabot alert. The escape-hatch assertions above
    // iterate every `npm audit` step, so this one inherits them; what needs
    // pinning is that the step exists at all and still gates at high.
    const loadtestsAudit = auditRunSteps.find((s) => s['working-directory'] === 'loadtests');

    expect(loadtestsAudit, 'no loadtests audit step found').toBeDefined();
    expect(loadtestsAudit!.run).toContain('--audit-level=high');
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
