import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

const ROOT = resolve(__dirname, '../..');

interface Job {
  needs?: string | string[];
  if?: string;
  steps?: Array<{
    name?: string;
    run?: string;
    env?: Record<string, string>;
    'continue-on-error'?: boolean;
  }>;
}

interface Workflow {
  jobs: Record<string, Job>;
}

const workflow = parseYaml(
  readFileSync(resolve(ROOT, '.github/workflows/ci.yml'), 'utf-8'),
) as Workflow;

const needsOf = (job: Job): string[] =>
  job.needs === undefined ? [] : Array.isArray(job.needs) ? job.needs : [job.needs];

/** Jobs that depend (directly or transitively) on `target`. */
function downstreamOf(target: string): Set<string> {
  const found = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const [name, job] of Object.entries(workflow.jobs)) {
      if (found.has(name)) continue;
      if (needsOf(job).some((n) => n === target || found.has(n))) {
        found.add(name);
        changed = true;
      }
    }
  }
  return found;
}

/**
 * test-gate is the single required status check (#1711). A job whose `needs`
 * failed is *skipped*, and a skipped required check counts as passing — so the
 * gate must run with `always()` and itself fail on any non-success result.
 */
describe('ci.yml test-gate (#1711)', () => {
  const gate = workflow.jobs['test-gate'];

  it('exists', () => {
    expect(gate).toBeDefined();
  });

  it('runs even when upstream jobs fail or are skipped (if: always())', () => {
    expect(gate.if?.replace(/\s+/g, '')).toBe('always()');
  });

  it('needs every other job that is not downstream of the gate', () => {
    const downstream = downstreamOf('test-gate');
    const expected = Object.keys(workflow.jobs).filter(
      (n) => n !== 'test-gate' && !downstream.has(n),
    );
    expect(expected).toContain('lockfile-integrity');
    expect([...needsOf(gate)].sort()).toEqual(expected.sort());
  });

  it('gates only on unconditional jobs, so "skipped" is never a legitimate result', () => {
    // If a needed job grows an `if:`, a skip may become legitimate and the
    // strict check below must be revisited deliberately.
    for (const name of needsOf(gate)) {
      expect(workflow.jobs[name].if, `${name} must not be conditional`).toBeUndefined();
    }
  });

  it('has a step that fails unless every needed job succeeded', () => {
    const step = gate.steps?.find((s) => s.env?.NEEDS_RESULTS !== undefined);
    expect(step).toBeDefined();
    expect(step!.env?.NEEDS_RESULTS).toBe('${{ toJSON(needs) }}');
    expect(step!.run).toMatch(/result != "success"/);
    expect(step!.run).toMatch(/exit 1/);
    expect(step!['continue-on-error']).toBeUndefined();
  });
});
