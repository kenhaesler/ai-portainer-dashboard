import { beforeAll, afterAll, describe, it, expect, vi, beforeEach } from 'vitest';
import { setConfigForTest, resetConfig } from '@dashboard/core/config/index.js';

// Kept: undici mock — external dependency
vi.mock('undici', () => ({
  Agent: vi.fn(function () { return { close: vi.fn().mockResolvedValue(undefined) }; }),
  fetch: vi.fn(),
}));

// Kept: trace-context mock — side-effect isolation
vi.mock('@dashboard/core/tracing/trace-context.js', () => ({
  withSpan: (_name: string, _service: string, _kind: string, fn: () => unknown) => fn(),
}));

// Kept: settings-store mock — no PostgreSQL in CI
vi.mock('@dashboard/core/services/settings-store.js', () => ({
  getEffectiveHarborConfig: vi.fn(() => Promise.resolve({
    enabled: true,
    apiUrl: 'https://harbor.example.com',
    robotName: 'robot$test',
    robotSecret: 'test-secret',
    verifySsl: true,
    syncIntervalMinutes: 30,
  })),
}));

import { Agent, fetch as undiciFetch } from 'undici';
import { getEffectiveHarborConfig } from '@dashboard/core/services/settings-store.js';
import { isHarborConfigured, isHarborConfiguredAsync, testConnection, _resetHarborClientState } from '../services/harbor-client.js';

const MockAgent = vi.mocked(Agent);
const mockFetch = vi.mocked(undiciFetch);
const mockGetEffectiveHarborConfig = vi.mocked(getEffectiveHarborConfig);

function mockOkResponse(data: unknown = { critical_cnt: 0, total_vuls: 0 }) {
  return {
    ok: true,
    status: 200,
    json: async () => data,
    headers: new Headers(),
  } as unknown as ReturnType<typeof undiciFetch> extends Promise<infer R> ? R : never;
}


beforeAll(() => {
    setConfigForTest({
      HARBOR_API_URL: 'https://harbor.example.com',
      HARBOR_ROBOT_NAME: 'robot$test',
      HARBOR_ROBOT_SECRET: 'test-secret',
      HARBOR_VERIFY_SSL: true,
      HARBOR_CONCURRENCY: 5,
    });
});

afterAll(() => {
  resetConfig();
});

describe('harbor-client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetHarborClientState();
  });

  describe('isHarborConfigured (sync, env-only)', () => {
    it('returns true when all Harbor config values are set', () => {
      expect(isHarborConfigured()).toBe(true);
    });
  });

  describe('isHarborConfiguredAsync (DB + env)', () => {
    it('returns true when DB settings have all required values', async () => {
      expect(await isHarborConfiguredAsync()).toBe(true);
    });

    it('returns false when DB settings are missing credentials', async () => {
      mockGetEffectiveHarborConfig.mockResolvedValueOnce({
        enabled: true,
        apiUrl: 'https://harbor.example.com',
        robotName: '',
        robotSecret: '',
        verifySsl: true,
        syncIntervalMinutes: 30,
      });
      expect(await isHarborConfiguredAsync()).toBe(false);
    });
  });

  describe('testConnection', () => {
    it('returns ok: true when Harbor responds successfully', async () => {
      mockFetch.mockResolvedValueOnce(mockOkResponse());

      const result = await testConnection();
      expect(result.ok).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('returns ok: false when Harbor is unreachable', async () => {
      mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const result = await testConnection();
      expect(result.ok).toBe(false);
      expect(result.error).toContain('ECONNREFUSED');
    });

    it('returns ok: false on 401 auth failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => 'Unauthorized',
        headers: new Headers(),
      } as unknown as ReturnType<typeof undiciFetch> extends Promise<infer R> ? R : never);

      const result = await testConnection();
      expect(result.ok).toBe(false);
      expect(result.error).toContain('401');
    });
  });

  describe('authentication', () => {
    it('sends Basic auth header with robot credentials from DB config', async () => {
      mockFetch.mockResolvedValueOnce(mockOkResponse());

      await testConnection();

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const callArgs = mockFetch.mock.calls[0];
      const headers = callArgs[1]?.headers as Record<string, string>;
      expect(headers['Authorization']).toMatch(/^Basic /);

      // Verify base64 encodes robot$test:test-secret
      const decoded = Buffer.from(headers['Authorization'].replace('Basic ', ''), 'base64').toString();
      expect(decoded).toBe('robot$test:test-secret');
    });

    it('builds correct URL with /api/v2.0 prefix from DB config', async () => {
      mockFetch.mockResolvedValueOnce(mockOkResponse());

      await testConnection();

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain('https://harbor.example.com/api/v2.0/security/summary');
    });
  });

  describe('listVulnerabilities (#741)', () => {
    it('returns total: 0 when x-total-count header is missing', async () => {
      const mockItems = [{ cve_id: 'CVE-2024-0001', severity: 'High' }];
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockItems,
        headers: new Headers(), // no x-total-count header
      } as unknown as ReturnType<typeof undiciFetch> extends Promise<infer R> ? R : never);

      const { listVulnerabilities } = await import('../services/harbor-client.js');
      const result = await listVulnerabilities({ page: 1, pageSize: 100 });
      expect(result.total).toBe(0);
      expect(result.items).toEqual(mockItems);
    });

    it('returns parsed total when x-total-count header is present', async () => {
      const mockItems = [{ cve_id: 'CVE-2024-0002', severity: 'Critical' }];
      const headers = new Headers();
      headers.set('x-total-count', '500');
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockItems,
        headers,
      } as unknown as ReturnType<typeof undiciFetch> extends Promise<infer R> ? R : never);

      const { listVulnerabilities } = await import('../services/harbor-client.js');
      const result = await listVulnerabilities({ page: 1, pageSize: 100 });
      expect(result.total).toBe(500);
    });
  });

  describe('DB settings override env vars', () => {
    it('uses DB settings for URL and credentials when different from env', async () => {
      mockGetEffectiveHarborConfig.mockResolvedValueOnce({
        enabled: true,
        apiUrl: 'https://harbor-db.example.com',
        robotName: 'robot$db-user',
        robotSecret: 'db-secret',
        verifySsl: false,
        syncIntervalMinutes: 15,
      });
      mockFetch.mockResolvedValueOnce(mockOkResponse());

      await testConnection();

      // Verify URL comes from DB config, not env
      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain('https://harbor-db.example.com/api/v2.0/security/summary');

      // Verify credentials come from DB config
      const headers = mockFetch.mock.calls[0][1]?.headers as Record<string, string>;
      const decoded = Buffer.from(headers['Authorization'].replace('Basic ', ''), 'base64').toString();
      expect(decoded).toBe('robot$db-user:db-secret');
    });

    it('calls getEffectiveHarborConfig on every request', async () => {
      mockFetch.mockResolvedValue(mockOkResponse());

      await testConnection();
      await testConnection();

      // Each testConnection call goes through harborFetch which calls resolveConfig
      expect(mockGetEffectiveHarborConfig).toHaveBeenCalledTimes(2);
    });
  });

  describe('harborFetchPaginated auth with DB-resolved credentials (#726)', () => {
    it('sends Basic auth header with DB credentials in paginated requests (getProjects)', async () => {
      mockGetEffectiveHarborConfig.mockResolvedValue({
        enabled: true,
        apiUrl: 'https://harbor.example.com',
        robotName: 'robot$paginated-user',
        robotSecret: 'paginated-secret',
        verifySsl: true,
        syncIntervalMinutes: 30,
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [],
        headers: new Headers({ 'x-total-count': '0' }),
      } as unknown as ReturnType<typeof undiciFetch> extends Promise<infer R> ? R : never);

      const { getProjects } = await import('../services/harbor-client.js');
      await getProjects();

      const headers = mockFetch.mock.calls[0][1]?.headers as Record<string, string>;
      const decoded = Buffer.from(headers['Authorization'].replace('Basic ', ''), 'base64').toString();
      expect(decoded).toBe('robot$paginated-user:paginated-secret');
    });

    it('sends Basic auth header with DB credentials in listVulnerabilities', async () => {
      mockGetEffectiveHarborConfig.mockResolvedValue({
        enabled: true,
        apiUrl: 'https://harbor.example.com',
        robotName: 'robot$vuln-user',
        robotSecret: 'vuln-secret',
        verifySsl: true,
        syncIntervalMinutes: 30,
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [],
        headers: new Headers(),
      } as unknown as ReturnType<typeof undiciFetch> extends Promise<infer R> ? R : never);

      const { listVulnerabilities } = await import('../services/harbor-client.js');
      await listVulnerabilities({ page: 1, pageSize: 10 });

      const headers = mockFetch.mock.calls[0][1]?.headers as Record<string, string>;
      const decoded = Buffer.from(headers['Authorization'].replace('Basic ', ''), 'base64').toString();
      expect(decoded).toBe('robot$vuln-user:vuln-secret');
    });

    it('builds correct paginated URL with page and page_size params', async () => {
      mockGetEffectiveHarborConfig.mockResolvedValue({
        enabled: true,
        apiUrl: 'https://harbor.example.com',
        robotName: 'robot$test',
        robotSecret: 'test-secret',
        verifySsl: true,
        syncIntervalMinutes: 30,
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [],
        headers: new Headers({ 'x-total-count': '0' }),
      } as unknown as ReturnType<typeof undiciFetch> extends Promise<infer R> ? R : never);

      const { getProjects } = await import('../services/harbor-client.js');
      await getProjects();

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain('/api/v2.0/projects');
      expect(url).toContain('page=1');
      expect(url).toContain('page_size=100');
    });
  });

  describe('SSL dispatcher recreation when verifySsl toggles (#726)', () => {
    it('creates Agent with rejectUnauthorized=false when verifySsl is disabled', async () => {
      mockGetEffectiveHarborConfig.mockResolvedValue({
        enabled: true,
        apiUrl: 'https://harbor.example.com',
        robotName: 'robot$test',
        robotSecret: 'test-secret',
        verifySsl: false,
        syncIntervalMinutes: 30,
      });
      mockFetch.mockResolvedValueOnce(mockOkResponse());

      await testConnection();

      expect(MockAgent).toHaveBeenCalledWith(
        expect.objectContaining({ connect: { rejectUnauthorized: false } }),
      );
    });

    it('creates Agent without connect options when verifySsl is enabled', async () => {
      mockGetEffectiveHarborConfig.mockResolvedValue({
        enabled: true,
        apiUrl: 'https://harbor.example.com',
        robotName: 'robot$test',
        robotSecret: 'test-secret',
        verifySsl: true,
        syncIntervalMinutes: 30,
      });
      mockFetch.mockResolvedValueOnce(mockOkResponse());

      await testConnection();

      const callArgs = MockAgent.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(callArgs).not.toHaveProperty('connect');
    });

    it('recreates Agent when verifySsl toggles from true to false', async () => {
      // First call with verifySsl=true
      mockGetEffectiveHarborConfig.mockResolvedValueOnce({
        enabled: true,
        apiUrl: 'https://harbor.example.com',
        robotName: 'robot$test',
        robotSecret: 'test-secret',
        verifySsl: true,
        syncIntervalMinutes: 30,
      });
      mockFetch.mockResolvedValueOnce(mockOkResponse());
      await testConnection();
      const firstAgentCallCount = MockAgent.mock.calls.length;

      // Second call with verifySsl=false — should recreate Agent
      mockGetEffectiveHarborConfig.mockResolvedValueOnce({
        enabled: true,
        apiUrl: 'https://harbor.example.com',
        robotName: 'robot$test',
        robotSecret: 'test-secret',
        verifySsl: false,
        syncIntervalMinutes: 30,
      });
      mockFetch.mockResolvedValueOnce(mockOkResponse());
      await testConnection();

      // Agent should have been constructed a second time for the new SSL setting
      expect(MockAgent.mock.calls.length).toBeGreaterThan(firstAgentCallCount);
      // The second Agent should have rejectUnauthorized=false
      const lastCallArgs = MockAgent.mock.calls[MockAgent.mock.calls.length - 1]?.[0] as Record<string, unknown>;
      expect(lastCallArgs).toHaveProperty('connect', { rejectUnauthorized: false });
    });

    it('reuses the same Agent when verifySsl stays the same', async () => {
      mockGetEffectiveHarborConfig.mockResolvedValue({
        enabled: true,
        apiUrl: 'https://harbor.example.com',
        robotName: 'robot$test',
        robotSecret: 'test-secret',
        verifySsl: true,
        syncIntervalMinutes: 30,
      });
      mockFetch.mockResolvedValue(mockOkResponse());

      await testConnection();
      await testConnection();

      // Agent should only be constructed once (reused for same verifySsl value)
      expect(MockAgent).toHaveBeenCalledTimes(1);
    });
  });

  describe('buildHeaders', () => {
    it('omits Authorization header when credentials are empty strings', async () => {
      mockGetEffectiveHarborConfig.mockResolvedValueOnce({
        enabled: true,
        apiUrl: 'https://harbor.example.com',
        robotName: '',
        robotSecret: '',
        verifySsl: true,
        syncIntervalMinutes: 30,
      });
      mockFetch.mockResolvedValueOnce(mockOkResponse());

      await testConnection();

      const callArgs = mockFetch.mock.calls[0];
      const headers = callArgs[1]?.headers as Record<string, string>;
      expect(headers['Authorization']).toBeUndefined();
      expect(headers['Content-Type']).toBe('application/json');
      expect(headers['Accept']).toBe('application/json');
    });
  });
});
