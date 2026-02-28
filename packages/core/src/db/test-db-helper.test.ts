/**
 * Unit tests for test-db-helper env var construction.
 *
 * These tests verify that the connection URL is built from individual
 * environment variables, and that POSTGRES_TEST_URL takes full precedence.
 *
 * Because the env vars are evaluated at module scope, each test uses
 * vi.resetModules() + a fresh dynamic import so the module re-evaluates
 * process.env on each load.
 *
 * We use vi.mock('pg') instead of vi.spyOn because vi.spyOn only modifies
 * the pg object in the test's own import — after vi.resetModules(), the
 * dynamically imported test-db-helper.js gets a fresh pg without the spy.
 * vi.mock persists across module resets at the resolution level.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type pg from 'pg';

// Track Pool constructor calls across module resets
let poolConstructorCalls: unknown[][] = [];

vi.mock('pg', async (importOriginal) => {
  const actual = await importOriginal<typeof import('pg')>();

  // Use a regular function (not arrow) so it works with `new`
  function MockPool(this: unknown, ...args: unknown[]) {
    poolConstructorCalls.push(args);
    return {
      query: vi.fn().mockResolvedValue({ rows: [] }),
      connect: vi.fn(),
      end: vi.fn().mockResolvedValue(undefined),
    };
  }

  return {
    ...actual,
    default: {
      ...actual.default,
      Pool: MockPool,
    },
  };
});

// Snapshot of original env so we can restore after each test
const originalEnv = { ...process.env };

beforeEach(() => {
  vi.resetModules();
  poolConstructorCalls = [];
});

afterEach(() => {
  // Restore environment
  process.env = { ...originalEnv };
});

/**
 * Helper: sets env vars, dynamically imports test-db-helper, calls getTestPool()
 * (which triggers ensurePool → new pg.Pool), and returns the connectionString
 * that was passed to the Pool constructor.
 */
async function getConnectionString(envOverrides: Record<string, string | undefined>): Promise<string> {
  // Apply overrides (undefined = delete)
  for (const [key, value] of Object.entries(envOverrides)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  // Dynamic import after env is set — module-scope vars re-evaluate
  const mod = await import('./test-db-helper.js');
  await mod.getTestPool();

  // Extract connectionString from the Pool constructor call
  expect(poolConstructorCalls).toHaveLength(1);
  const opts = poolConstructorCalls[0][0] as pg.PoolConfig;
  return opts.connectionString!;
}

describe('test-db-helper env var construction', () => {
  it('uses safe defaults when no env vars are set', async () => {
    // Remove all overrides so defaults kick in
    const url = await getConnectionString({
      POSTGRES_TEST_URL: undefined,
      POSTGRES_TEST_USER: undefined,
      POSTGRES_TEST_PASSWORD: undefined,
      POSTGRES_TEST_HOST: undefined,
      POSTGRES_TEST_PORT: undefined,
      POSTGRES_TEST_DB: undefined,
      POSTGRES_APP_PASSWORD: undefined,
    });

    expect(url).toBe(
      'postgresql://app_user:changeme-postgres-app@localhost:5433/portainer_dashboard_test',
    );
  });

  it('POSTGRES_TEST_URL takes full precedence over individual vars', async () => {
    const fullUrl = 'postgresql://custom:secret@remote:9999/mydb';
    const url = await getConnectionString({
      POSTGRES_TEST_URL: fullUrl,
      POSTGRES_TEST_USER: 'ignored',
      POSTGRES_TEST_PASSWORD: 'ignored',
    });

    expect(url).toBe(fullUrl);
  });

  it('POSTGRES_TEST_PASSWORD overrides the default password', async () => {
    const url = await getConnectionString({
      POSTGRES_TEST_URL: undefined,
      POSTGRES_TEST_PASSWORD: 'ci-injected-password',
      POSTGRES_APP_PASSWORD: undefined,
    });

    expect(url).toBe(
      'postgresql://app_user:ci-injected-password@localhost:5433/portainer_dashboard_test',
    );
  });

  it('POSTGRES_APP_PASSWORD is used as fallback when POSTGRES_TEST_PASSWORD is not set', async () => {
    const url = await getConnectionString({
      POSTGRES_TEST_URL: undefined,
      POSTGRES_TEST_PASSWORD: undefined,
      POSTGRES_APP_PASSWORD: 'compose-password',
    });

    expect(url).toBe(
      'postgresql://app_user:compose-password@localhost:5433/portainer_dashboard_test',
    );
  });

  it('POSTGRES_TEST_PASSWORD takes priority over POSTGRES_APP_PASSWORD', async () => {
    const url = await getConnectionString({
      POSTGRES_TEST_URL: undefined,
      POSTGRES_TEST_PASSWORD: 'explicit-test-pw',
      POSTGRES_APP_PASSWORD: 'compose-password',
    });

    expect(url).toBe(
      'postgresql://app_user:explicit-test-pw@localhost:5433/portainer_dashboard_test',
    );
  });

  it('individual host/port/user/db vars are respected', async () => {
    const url = await getConnectionString({
      POSTGRES_TEST_URL: undefined,
      POSTGRES_TEST_USER: 'custom_user',
      POSTGRES_TEST_PASSWORD: 'custom_pass',
      POSTGRES_TEST_HOST: 'db.internal',
      POSTGRES_TEST_PORT: '5555',
      POSTGRES_TEST_DB: 'custom_test_db',
    });

    expect(url).toBe(
      'postgresql://custom_user:custom_pass@db.internal:5555/custom_test_db',
    );
  });

  it('URL-encodes special characters in user and password', async () => {
    const url = await getConnectionString({
      POSTGRES_TEST_URL: undefined,
      POSTGRES_TEST_USER: 'user@domain',
      POSTGRES_TEST_PASSWORD: 'p@ss:word/test#1',
    });

    // @ : / # in credentials must be percent-encoded
    expect(url).toBe(
      'postgresql://user%40domain:p%40ss%3Aword%2Ftest%231@localhost:5433/portainer_dashboard_test',
    );
  });
});
