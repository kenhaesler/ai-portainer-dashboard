import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('undici', () => ({
  Agent: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock('../config/index.js', () => ({
  getConfig: vi.fn(() => ({
    HARBOR_API_URL: 'https://harbor.example.com',
    HARBOR_ROBOT_NAME: 'robot$test',
    HARBOR_ROBOT_SECRET: 'test-secret',
    HARBOR_VERIFY_SSL: true,
    HARBOR_CONCURRENCY: 5,
  })),
}));

vi.mock('../utils/logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('./trace-context.js', () => ({
  withSpan: (_name: string, _service: string, _kind: string, fn: () => unknown) => fn(),
}));

vi.mock('./settings-store.js', () => ({
  getEffectiveHarborConfig: vi.fn(() => Promise.resolve({
    enabled: true,
    apiUrl: 'https://harbor.example.com',
    robotName: 'robot$test',
    robotSecret: 'test-secret',
    verifySsl: true,
    syncIntervalMinutes: 30,
  })),
}));

import { fetch as undiciFetch } from 'undici';
import { getEffectiveHarborConfig } from './settings-store.js';
import { isHarborConfigured, isHarborConfiguredAsync, testConnection, _resetHarborClientState } from './harbor-client.js';

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
});
