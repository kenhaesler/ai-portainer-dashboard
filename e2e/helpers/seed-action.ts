import { randomUUID } from 'node:crypto';
import pg from 'pg';

const { Client } = pg;

/**
 * Seed helper for the remediation-approval E2E spec.
 *
 * The product is observer-first: remediation actions are proposed by the AI
 * monitor, never created by a client, so there is deliberately no
 * create-action API. To exercise the approve → execute state machine end to
 * end we insert a `pending` row straight into the app database.
 *
 * The e2e compose override publishes the app Postgres on 127.0.0.1:5442
 * (docker/docker-compose.e2e.yml). If it is unreachable — e.g. running the
 * specs against a stack that did not layer the override — `isDbReachable()`
 * returns false and the seed-dependent tests skip with a clear message rather
 * than faking a pass.
 */
const DB_URL =
  process.env.E2E_APP_DB_URL ??
  `postgresql://app_user:${process.env.POSTGRES_APP_PASSWORD ?? 'changeme-postgres-app'}@localhost:5442/portainer_dashboard`;

export interface SeededAction {
  id: string;
  containerId: string;
  containerName: string;
  actionType: string;
}

async function withClient<T>(fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: DB_URL, connectionTimeoutMillis: 4000 });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/** True when the app Postgres is reachable for seeding. */
export async function isDbReachable(): Promise<boolean> {
  try {
    await withClient((c) => c.query('SELECT 1'));
    return true;
  } catch {
    return false;
  }
}

/**
 * Insert one `pending` action and return its identifiers. A random container id
 * keeps each seed distinct so the partial unique index on
 * (container_id, action_type) WHERE status='pending' never collides across
 * tests or retries.
 */
export async function seedPendingAction(
  overrides: Partial<SeededAction> = {},
): Promise<SeededAction> {
  const action: SeededAction = {
    id: overrides.id ?? `e2e-${randomUUID()}`,
    containerId: overrides.containerId ?? `e2e-container-${randomUUID().slice(0, 8)}`,
    containerName: overrides.containerName ?? 'e2e-remediation-target',
    actionType: overrides.actionType ?? 'RESTART_CONTAINER',
  };

  await withClient((c) =>
    c.query(
      `INSERT INTO actions
         (id, insight_id, endpoint_id, container_id, container_name, action_type, rationale, status, created_at)
       VALUES ($1, NULL, $2, $3, $4, $5, $6, 'pending', NOW())`,
      [action.id, 1, action.containerId, action.containerName, action.actionType,
        'Seeded by the E2E remediation-approval spec (#1521)'],
    ),
  );

  return action;
}

/** Read an action's current status, or null if it no longer exists. */
export async function getActionStatus(id: string): Promise<string | null> {
  return withClient(async (c) => {
    const res = await c.query<{ status: string }>('SELECT status FROM actions WHERE id = $1', [id]);
    return res.rows[0]?.status ?? null;
  });
}

/** Best-effort cleanup — never throws so it is safe in a finally block. */
export async function deleteAction(id: string): Promise<void> {
  await withClient((c) => c.query('DELETE FROM actions WHERE id = $1', [id])).catch(() => undefined);
}
