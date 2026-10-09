/**
 * Decides what a failed e2e seed means (#1712). The remediation-approval spec
 * is the only e2e proof of the approval gate, so in CI a seeding failure must
 * fail the run rather than turn into a green skip. Locally (no e2e stack) a
 * skip with an explicit reason is fine.
 */
export const SEED_SKIP_REASON =
  'app Postgres not reachable for seeding — docker-compose.e2e.yml publishes it on 127.0.0.1:5442';

export interface SeedFailureDecision {
  mode: 'fail' | 'skip';
  message: string;
}

export function decideSeedFailure(ci: string | undefined, detail: string): SeedFailureDecision {
  const inCi = ci !== undefined && ci !== '' && ci !== '0' && ci.toLowerCase() !== 'false';
  if (inCi) {
    return {
      mode: 'fail',
      message: `E2E seeding failed in CI (${detail}); refusing to skip the remediation approval-gate test. ${SEED_SKIP_REASON}`,
    };
  }
  return { mode: 'skip', message: SEED_SKIP_REASON };
}
