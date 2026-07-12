import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

const ROOT = resolve(__dirname, '../..');

interface Workflow {
  concurrency?:
    | { group?: string; 'cancel-in-progress'?: boolean | string }
    | undefined;
}

function readWorkflow(relativePath: string): Workflow {
  const content = readFileSync(resolve(ROOT, `.github/workflows/${relativePath}`), 'utf-8');
  return parseYaml(content) as Workflow;
}

/**
 * CI concurrency control (#1551): a new commit pushed to an open PR
 * (`synchronize`) supersedes the previous run, but without a `concurrency`
 * group the old full matrix keeps burning runner minutes to completion.
 * Every workflow that runs on pull_request/push must declare a per-ref
 * concurrency group that cancels superseded runs. Cancellation is scoped so
 * push-to-branch, tag, and nightly-schedule runs on protected branches are
 * never pre-empted.
 */
describe('.github/workflows concurrency control (#1551)', () => {
  // Workflows that trigger on pull_request/push and therefore need a group.
  const workflows = ['ci.yml', 'docker-build.yml', 'enforce-branch-policy.yml'];

  for (const file of workflows) {
    describe(file, () => {
      const wf = readWorkflow(file);

      it('declares a concurrency block', () => {
        expect(wf.concurrency).toBeDefined();
      });

      it('scopes the group per-ref so unrelated branches/PRs never collide', () => {
        const group = wf.concurrency?.group ?? '';
        expect(group).toContain('github.ref');
        // Include the workflow name so different workflows on the same ref land
        // in separate groups and cannot cancel each other.
        expect(group).toContain('github.workflow');
      });

      it('cancels in-progress runs (guarded so protected-branch runs finish)', () => {
        const cancel = wf.concurrency?.['cancel-in-progress'];
        expect(cancel).toBeDefined();
        // Accept either an unconditional `true` (workflows that only run on
        // pull_request, e.g. enforce-branch-policy) or the pull_request-scoped
        // expression (workflows that also run on push/tag, so those must not
        // be pre-empted). Both satisfy the requirement.
        if (typeof cancel === 'string') {
          expect(cancel).toMatch(/pull_request|true/);
        } else {
          expect(cancel).toBe(true);
        }
      });
    });
  }

  // dev-nightly.yml triggers ONLY on schedule + workflow_dispatch and pushes
  // release images to the registry (deploy-critical). It has no PR/push churn
  // to control, and cancelling a nightly mid-push would be harmful — so it is
  // intentionally left without a concurrency block. Guard that deliberate choice.
  it('dev-nightly.yml is intentionally left without a concurrency group', () => {
    expect(readWorkflow('dev-nightly.yml').concurrency).toBeUndefined();
  });
});
