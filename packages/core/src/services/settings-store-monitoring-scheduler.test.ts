import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the DB router so getSetting hits an in-memory map
const settingsMap = new Map<string, string>();

vi.mock('../db/app-db-router.js', () => {
  const mockDb = {
    queryOne: vi.fn(async (_sql: string, params: unknown[]) => {
      const key = params[0] as string;
      const value = settingsMap.get(key);
      if (value === undefined) return null;
      return { key, value, category: 'monitoring', updated_at: new Date().toISOString() };
    }),
    query: vi.fn(async () => []),
    execute: vi.fn(async () => ({ changes: 0 })),
  };
  return { getDbForDomain: () => mockDb };
});

// Must import after mocks are set up
import { getEffectiveMonitoringSchedulerConfig } from './settings-store.js';

beforeEach(() => {
  settingsMap.clear();
});

describe('getEffectiveMonitoringSchedulerConfig', () => {
  it('falls back to env config when no settings exist', async () => {
    const result = await getEffectiveMonitoringSchedulerConfig();
    // Defaults from env schema: MONITORING_ENABLED=true, MONITORING_INTERVAL_MINUTES=5
    expect(result.enabled).toBe(true);
    expect(result.intervalMinutes).toBe(5);
  });

  it('reads enabled=false from Settings DB', async () => {
    settingsMap.set('monitoring.enabled', 'false');
    const result = await getEffectiveMonitoringSchedulerConfig();
    expect(result.enabled).toBe(false);
  });

  it('reads enabled=true from Settings DB', async () => {
    settingsMap.set('monitoring.enabled', 'true');
    const result = await getEffectiveMonitoringSchedulerConfig();
    expect(result.enabled).toBe(true);
  });

  it('reads custom intervalMinutes from Settings DB', async () => {
    settingsMap.set('monitoring.scheduler_interval_minutes', '10');
    const result = await getEffectiveMonitoringSchedulerConfig();
    expect(result.intervalMinutes).toBe(10);
  });

  it('falls back to env default when interval is empty string', async () => {
    settingsMap.set('monitoring.scheduler_interval_minutes', '');
    const result = await getEffectiveMonitoringSchedulerConfig();
    expect(result.intervalMinutes).toBe(5);
  });

  it('falls back to env default when interval is non-numeric', async () => {
    settingsMap.set('monitoring.scheduler_interval_minutes', 'abc');
    const result = await getEffectiveMonitoringSchedulerConfig();
    expect(result.intervalMinutes).toBe(5);
  });

  it('combines both settings correctly', async () => {
    settingsMap.set('monitoring.enabled', 'false');
    settingsMap.set('monitoring.scheduler_interval_minutes', '15');
    const result = await getEffectiveMonitoringSchedulerConfig();
    expect(result.enabled).toBe(false);
    expect(result.intervalMinutes).toBe(15);
  });
});
