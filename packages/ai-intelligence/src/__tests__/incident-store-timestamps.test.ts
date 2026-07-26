/**
 * Regression guard for the "Invalid date" rollup (design critique, P0).
 *
 * `getIncidentGroups` used to render its timestamps with a `::text` cast, which
 * drops the timestamptz OID and therefore bypasses the driver's ISO type parser
 * (`pg.types.setTypeParser(1184, …)` in core/db/postgres.ts). Rows then carried
 * Postgres' own text rendering — `2026-07-26 08:46:29.123456+00` — and the
 * frontend's `formatDate()` (which swaps the first space for a `T`) turned that
 * into `2026-07-26T08:46:29.123456+00`, an offset shape `new Date()` rejects.
 * Every row of the Active Incidents rollup printed the literal "Invalid date".
 *
 * These tests are DB-free: `toIsoTimestamp` is exercised directly, and
 * `getIncidentGroups` runs against a fake db so the shape of `top_containers[]`
 * is asserted without PostgreSQL.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

interface FakeQuery { sql: string; params: unknown[] }
const queries: FakeQuery[] = [];
let groupRows: unknown[] = [];
let topRows: unknown[] = [];
let facetRows: unknown[] = [];

const fakeDb = {
  query: vi.fn(async (sql: string, params: unknown[] = []) => {
    queries.push({ sql, params });
    if (sql.includes('per_container')) return groupRows;
    if (sql.includes('representatives')) return topRows;
    return facetRows;
  }),
  queryOne: vi.fn(),
  execute: vi.fn(),
};

vi.mock('@dashboard/core/db/app-db-router.js', () => ({
  getDbForDomain: () => fakeDb,
}));

import { toIsoTimestamp, getIncidentGroups } from '../services/incident-store.js';

/** The exact string Postgres produces for `timestamptz::text`. */
const PG_TEXT_TIMESTAMPTZ = '2026-07-26 08:46:29.123456+00';

describe('toIsoTimestamp', () => {
  it('converts the Postgres ::text rendering that broke the UI into ISO-8601', () => {
    expect(toIsoTimestamp(PG_TEXT_TIMESTAMPTZ)).toBe('2026-07-26T08:46:29.123Z');
  });

  it('produces a string the browser Date constructor accepts after formatDate() swaps space for T', () => {
    // formatDate() in frontend/src/shared/lib/utils.ts does `.replace(' ', 'T')`
    // before calling new Date(). That is what made the raw Postgres text fail.
    const raw = toIsoTimestamp(PG_TEXT_TIMESTAMPTZ)!;
    expect(Number.isNaN(new Date(raw.replace(' ', 'T')).getTime())).toBe(false);
    // ...and the pre-fix value genuinely fails that same path, so this test
    // would not have passed before the change.
    expect(Number.isNaN(new Date(PG_TEXT_TIMESTAMPTZ.replace(' ', 'T')).getTime())).toBe(true);
  });

  it('passes an ISO string through unchanged in meaning', () => {
    expect(toIsoTimestamp('2026-07-26T08:46:29.123Z')).toBe('2026-07-26T08:46:29.123Z');
  });

  it('serialises a Date instance (what the driver returns without a cast)', () => {
    expect(toIsoTimestamp(new Date('2026-07-26T08:46:29.000Z'))).toBe('2026-07-26T08:46:29.000Z');
  });

  it('treats a zone-less Postgres timestamp as UTC, matching the driver type parser', () => {
    expect(toIsoTimestamp('2026-07-26 08:46:29')).toBe('2026-07-26T08:46:29.000Z');
  });

  it('returns null rather than a broken string for null, empty and unparseable input', () => {
    expect(toIsoTimestamp(null)).toBeNull();
    expect(toIsoTimestamp(undefined)).toBeNull();
    expect(toIsoTimestamp('')).toBeNull();
    expect(toIsoTimestamp('   ')).toBeNull();
    expect(toIsoTimestamp('not a timestamp')).toBeNull();
    expect(toIsoTimestamp(new Date('nope'))).toBeNull();
    expect(toIsoTimestamp({})).toBeNull();
  });
});

describe('getIncidentGroups timestamp shape', () => {
  beforeEach(() => {
    queries.length = 0;
    groupRows = [];
    topRows = [];
    facetRows = [];
    fakeDb.query.mockClear();
  });

  it('emits ISO-8601 timestamps on groups and top_containers', async () => {
    groupRows = [{
      signature: 'anomaly:ml-anomaly:cpu',
      severity: 'critical',
      incident_count: 2,
      alert_count: 5,
      earliest_at: PG_TEXT_TIMESTAMPTZ,
      latest_update_at: new Date('2026-07-26T09:00:00.000Z'),
      container_count: 1,
      all_names: ['web'],
    }];
    topRows = [{
      signature: 'anomaly:ml-anomaly:cpu',
      incident_id: 'a1',
      container_name: 'web',
      endpoint_id: 1,
      endpoint_name: 'local',
      severity: 'critical',
      created_at: PG_TEXT_TIMESTAMPTZ,
      incident_ids: ['a1', 'a2'],
      incident_count: 2,
      latest_at: PG_TEXT_TIMESTAMPTZ,
      latest_summary: null,
      latest_description: null,
    }];

    const result = await getIncidentGroups({ status: 'active' });
    const group = result.groups[0];
    const row = group.top_containers[0];

    expect(row.created_at).toBe('2026-07-26T08:46:29.123Z');
    expect(row.latest_at).toBe('2026-07-26T08:46:29.123Z');
    expect(group.earliest_at).toBe('2026-07-26T08:46:29.123Z');
    expect(group.latest_update_at).toBe('2026-07-26T09:00:00.000Z');

    // Every emitted timestamp must survive `new Date()` — the assertion the UI
    // silently relied on.
    for (const value of [row.created_at, row.latest_at, group.earliest_at, group.latest_update_at]) {
      expect(Number.isNaN(new Date(value!).getTime())).toBe(false);
    }
  });

  it('does not cast timestamps to text in SQL (the cast is the root cause)', async () => {
    await getIncidentGroups({ status: 'active' });
    const sql = queries.map((q) => q.sql).join('\n');
    expect(sql).not.toMatch(/created_at\)?::text/);
    expect(sql).not.toMatch(/updated_at\)?::text/);
  });

  it('reports an unusable timestamp as null instead of a broken string', async () => {
    groupRows = [{
      signature: 'anomaly:ml-anomaly:cpu',
      severity: 'warning',
      incident_count: 1,
      alert_count: 1,
      earliest_at: null,
      latest_update_at: null,
      container_count: 1,
      all_names: ['web'],
    }];
    topRows = [{
      signature: 'anomaly:ml-anomaly:cpu',
      incident_id: 'a1',
      container_name: 'web',
      endpoint_id: null,
      endpoint_name: null,
      severity: 'warning',
      created_at: null,
      incident_ids: ['a1'],
      incident_count: 1,
      latest_at: 'garbage',
      latest_summary: null,
      latest_description: null,
    }];

    const result = await getIncidentGroups({ status: 'active' });
    const row = result.groups[0].top_containers[0];
    expect(row.created_at).toBeNull();
    expect(row.latest_at).toBeNull();
    expect(result.groups[0].earliest_at).toBeNull();
  });
});
