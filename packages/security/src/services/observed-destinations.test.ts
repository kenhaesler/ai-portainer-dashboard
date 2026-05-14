import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getTestDb, truncateTestTables, closeTestDb } from '@dashboard/core/db/test-db-helper.js';
import type { AppDb } from '@dashboard/core/db/app-db.js';

let testDb: AppDb;

vi.mock('@dashboard/core/db/app-db-router.js', () => ({
  getDbForDomain: () => testDb,
}));

import { aggregateObservedDestinations } from './observed-destinations.js';

async function insertSpan(opts: {
  id: string;
  trace_id?: string;
  start_time: Date;
  net_peer_name?: string | null;
  net_peer_port?: number | null;
  server_address?: string | null;
}): Promise<void> {
  await testDb.execute(
    `INSERT INTO spans (
       id, trace_id, parent_span_id, name, kind, status,
       start_time, end_time, duration_ms, service_name, attributes,
       net_peer_name, net_peer_port, server_address, created_at
     ) VALUES (?, ?, NULL, 'op', 'client', 'ok', ?, ?, 10, 's', '{}', ?, ?, ?, NOW())`,
    [
      opts.id,
      opts.trace_id ?? opts.id,
      opts.start_time.toISOString(),
      opts.start_time.toISOString(),
      opts.net_peer_name ?? null,
      opts.net_peer_port ?? null,
      opts.server_address ?? null,
    ],
  );
}

async function insertRule(pattern: string, type: 'cidr' | 'suffix', verdict: 'allow' | 'warn' | 'deny', reason: string): Promise<void> {
  await testDb.execute(
    `INSERT INTO security_destination_rules (pattern, pattern_type, verdict, reason)
     VALUES (?, ?, ?, ?)`,
    [pattern, type, verdict, reason],
  );
}

beforeAll(async () => { testDb = await getTestDb(); });
afterAll(async () => { await closeTestDb(); });
beforeEach(async () => {
  await truncateTestTables('spans', 'security_destination_rules');
});

describe('aggregateObservedDestinations', () => {
  it('returns warn verdict for unmatched destinations', async () => {
    const now = new Date('2026-05-14T12:00:00Z');
    await insertSpan({ id: 's1', start_time: now, net_peer_name: 'api.evil.example.com', net_peer_port: 443 });

    const result = await aggregateObservedDestinations({
      from: new Date('2026-05-14T11:00:00Z'),
      to: new Date('2026-05-14T13:00:00Z'),
    });

    expect(result).toHaveLength(1);
    expect(result[0].peer).toBe('api.evil.example.com');
    expect(result[0].verdict).toBe('warn');
    expect(result[0].callCount).toBe(1);
  });

  it('applies suffix rules to allow/warn/deny hostnames', async () => {
    const now = new Date('2026-05-14T12:00:00Z');
    await insertRule('.internal', 'suffix', 'allow', 'internal DNS');
    await insertRule('.evil.example.com', 'suffix', 'deny', 'known bad');

    await insertSpan({ id: 's1', start_time: now, net_peer_name: 'api.internal', net_peer_port: 80 });
    await insertSpan({ id: 's2', start_time: now, net_peer_name: 'api.evil.example.com', net_peer_port: 443 });
    await insertSpan({ id: 's3', start_time: now, net_peer_name: 'api.unknown.example.com', net_peer_port: 443 });

    const result = await aggregateObservedDestinations({
      from: new Date('2026-05-14T11:00:00Z'),
      to: new Date('2026-05-14T13:00:00Z'),
    });

    const byPeer = new Map(result.map((r) => [r.peer, r.verdict]));
    expect(byPeer.get('api.internal')).toBe('allow');
    expect(byPeer.get('api.evil.example.com')).toBe('deny');
    expect(byPeer.get('api.unknown.example.com')).toBe('warn');
  });

  it('applies CIDR rules to IPv4 destinations', async () => {
    const now = new Date('2026-05-14T12:00:00Z');
    await insertRule('10.0.0.0/8', 'cidr', 'allow', 'RFC1918');
    await insertRule('192.168.0.0/16', 'cidr', 'allow', 'RFC1918');
    await insertRule('8.8.8.8/32', 'cidr', 'deny', 'public DNS not allowed');

    await insertSpan({ id: 's1', start_time: now, net_peer_name: '10.1.2.3', net_peer_port: 80 });
    await insertSpan({ id: 's2', start_time: now, net_peer_name: '192.168.1.1', net_peer_port: 443 });
    await insertSpan({ id: 's3', start_time: now, net_peer_name: '8.8.8.8', net_peer_port: 53 });
    await insertSpan({ id: 's4', start_time: now, net_peer_name: '203.0.113.1', net_peer_port: 80 });

    const result = await aggregateObservedDestinations({
      from: new Date('2026-05-14T11:00:00Z'),
      to: new Date('2026-05-14T13:00:00Z'),
    });

    const byPeer = new Map(result.map((r) => [r.peer, r.verdict]));
    expect(byPeer.get('10.1.2.3')).toBe('allow');
    expect(byPeer.get('192.168.1.1')).toBe('allow');
    expect(byPeer.get('8.8.8.8')).toBe('deny');
    expect(byPeer.get('203.0.113.1')).toBe('warn');
  });

  it('falls back to server_address when net_peer_name is null', async () => {
    const now = new Date('2026-05-14T12:00:00Z');
    await insertSpan({ id: 's1', start_time: now, net_peer_name: null, server_address: 'fallback.example.com', net_peer_port: 80 });

    const result = await aggregateObservedDestinations({
      from: new Date('2026-05-14T11:00:00Z'),
      to: new Date('2026-05-14T13:00:00Z'),
    });

    expect(result).toHaveLength(1);
    expect(result[0].peer).toBe('fallback.example.com');
  });

  it('returns empty when no spans in window', async () => {
    const result = await aggregateObservedDestinations({
      from: new Date('2026-05-14T11:00:00Z'),
      to: new Date('2026-05-14T13:00:00Z'),
    });
    expect(result).toEqual([]);
  });
});
