import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { validatorCompiler, serializerCompiler } from 'fastify-type-provider-zod';
import { dashboardRoutes } from './dashboard.js';

const mockGetKpiHistory = vi.fn();

vi.mock('../services/kpi-store.js', () => ({
  getKpiHistory: (...args: unknown[]) => mockGetKpiHistory(...args),
}));

vi.mock('../utils/logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

describe('Dashboard Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('GET /api/dashboard/kpi-history returns snapshots', async () => {
    const app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.decorate('authenticate', async () => undefined);
    await app.register(dashboardRoutes);
    await app.ready();

    mockGetKpiHistory.mockReturnValue([
      {
        endpoints: 1,
        endpoints_up: 1,
        endpoints_down: 0,
        running: 2,
        stopped: 1,
        healthy: 2,
        unhealthy: 1,
        total: 3,
        stacks: 1,
        timestamp: '2026-02-07 12:00:00',
      },
    ]);

    const res = await app.inject({ method: 'GET', url: '/api/dashboard/kpi-history?hours=24' });
    expect(res.statusCode).toBe(200);
    expect(res.json().snapshots).toHaveLength(1);
    expect(mockGetKpiHistory).toHaveBeenCalledWith(24);

    await app.close();
  });

  it('GET /api/dashboard/kpi-history falls back to empty snapshots on store error', async () => {
    const app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.decorate('authenticate', async () => undefined);
    await app.register(dashboardRoutes);
    await app.ready();

    mockGetKpiHistory.mockImplementation(() => {
      throw new Error('no such table: kpi_snapshots');
    });

    const res = await app.inject({ method: 'GET', url: '/api/dashboard/kpi-history?hours=24' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ snapshots: [] });

    await app.close();
  });
});
