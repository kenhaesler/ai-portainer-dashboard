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

import { fetch as undiciFetch } from 'undici';
import { isHarborConfigured, testConnection, _resetHarborClientState } from './harbor-client.js';

const mockFetch = vi.mocked(undiciFetch);

describe('harbor-client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetHarborClientState();
  });

  describe('isHarborConfigured', () => {
    it('returns true when all Harbor config values are set', () => {
      expect(isHarborConfigured()).toBe(true);
    });
  });

  describe('testConnection', () => {
    it('returns ok: true when Harbor responds successfully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ critical_cnt: 0, total_vuls: 0 }),
        headers: new Headers(),
      } as unknown as ReturnType<typeof undiciFetch> extends Promise<infer R> ? R : never);

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
    it('sends Basic auth header with robot credentials', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ critical_cnt: 0 }),
        headers: new Headers(),
      } as unknown as ReturnType<typeof undiciFetch> extends Promise<infer R> ? R : never);

      await testConnection();

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const callArgs = mockFetch.mock.calls[0];
      const headers = callArgs[1]?.headers as Record<string, string>;
      expect(headers['Authorization']).toMatch(/^Basic /);

      // Verify base64 encodes robot$test:test-secret
      const decoded = Buffer.from(headers['Authorization'].replace('Basic ', ''), 'base64').toString();
      expect(decoded).toBe('robot$test:test-secret');
    });

    it('builds correct URL with /api/v2.0 prefix', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({}),
        headers: new Headers(),
      } as unknown as ReturnType<typeof undiciFetch> extends Promise<infer R> ? R : never);

      await testConnection();

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain('https://harbor.example.com/api/v2.0/security/summary');
    });
  });
});
