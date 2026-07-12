import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { api } from './api';
import { AUTH_TOKEN_KEY } from './auth-constants';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock crypto.randomUUID
vi.stubGlobal('crypto', {
  randomUUID: vi.fn(() => 'mock-uuid-123'),
});

describe('ApiClient', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    api.setToken(null);
    window.localStorage.removeItem(AUTH_TOKEN_KEY);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('setToken / getToken', () => {
    it('should store and retrieve token', () => {
      api.setToken('my-jwt-token');
      expect(api.getToken()).toBe('my-jwt-token');
    });

    it('should clear token when set to null', () => {
      api.setToken('token');
      api.setToken(null);
      expect(api.getToken()).toBeNull();
    });
  });

  describe('get', () => {
    it('should make GET request', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: 'test' }),
      });

      const result = await api.get('/api/test');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/test'),
        expect.objectContaining({ method: 'GET' })
      );
      expect(result).toEqual({ data: 'test' });
    });

    it('should include query parameters', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
      });

      await api.get('/api/items', { params: { page: 1, limit: 10 } });

      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain('page=1');
      expect(calledUrl).toContain('limit=10');
    });

    it('should exclude undefined params', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
      });

      await api.get('/api/items', { params: { page: 1, filter: undefined } });

      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain('page=1');
      expect(calledUrl).not.toContain('filter');
    });
  });

  describe('post', () => {
    it('should make POST request with body', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: 1 }),
      });

      const result = await api.post('/api/items', { name: 'test' });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/items'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ name: 'test' }),
        })
      );
      expect(result).toEqual({ id: 1 });
    });

    it('should make POST request without body', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      });

      await api.post('/api/logout');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/logout'),
        expect.objectContaining({
          method: 'POST',
          body: undefined,
        })
      );
    });
  });

  describe('put', () => {
    it('should make PUT request with body', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ updated: true }),
      });

      await api.put('/api/items/1', { name: 'updated' });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/items/1'),
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ name: 'updated' }),
        })
      );
    });
  });

  describe('delete', () => {
    it('should make DELETE request', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ deleted: true }),
      });

      await api.delete('/api/items/1');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/items/1'),
        expect.objectContaining({ method: 'DELETE' })
      );
    });
  });

  describe('authentication', () => {
    it('should hydrate token from localStorage on client initialization', async () => {
      window.localStorage.setItem(AUTH_TOKEN_KEY, 'persisted-token');
      vi.resetModules();
      const { api: freshApi } = await import('./api');

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
      });

      await freshApi.get('/api/protected');

      const headers = mockFetch.mock.calls[0][1]?.headers as Headers;
      expect(headers.get('Authorization')).toBe('Bearer persisted-token');
    });

    it('should include Authorization header when token is set', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
      });

      api.setToken('my-token');
      await api.get('/api/protected');

      const headers = mockFetch.mock.calls[0][1]?.headers as Headers;
      expect(headers.get('Authorization')).toBe('Bearer my-token');
    });

    it('should not include Authorization header when no token', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
      });

      api.setToken(null);
      await api.get('/api/public');

      const headers = mockFetch.mock.calls[0][1]?.headers as Headers;
      expect(headers.get('Authorization')).toBeNull();
    });

    it('should handle 401 by clearing token and dispatching event', async () => {
      const eventSpy = vi.fn();
      window.addEventListener('auth:expired', eventSpy);

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: () => Promise.resolve({}),
      });

      api.setToken('expired-token');

      await expect(api.get('/api/protected')).rejects.toThrow('Session expired');
      expect(api.getToken()).toBeNull();
      expect(eventSpy).toHaveBeenCalled();

      window.removeEventListener('auth:expired', eventSpy);
    });
  });

  describe('error handling', () => {
    it('should throw error for non-ok response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: 'Internal Server Error' }),
      });

      await expect(api.get('/api/broken')).rejects.toThrow('Internal Server Error');
    });

    it('should prefer descriptive message over Fastify generic error class', async () => {
      // Fastify default error shape: { statusCode, error: 'Internal Server Error', message: 'actual cause' }
      // Without this, eBPF deploy failures surface only as "Internal Server Error" instead of the underlying Portainer error.
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: () => Promise.resolve({
          statusCode: 500,
          error: 'Internal Server Error',
          message: 'HTTP 502: Bad Gateway',
        }),
      });

      await expect(api.post('/api/ebpf/deploy/3')).rejects.toThrow('HTTP 502: Bad Gateway');
    });

    it('should fall back to body.error when no message field is present', async () => {
      // Custom routes use reply.code(X).send({ error: 'descriptive' }) without a message field.
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ error: 'Coverage record not found' }),
      });

      await expect(api.delete('/api/ebpf/coverage/99')).rejects.toThrow('Coverage record not found');
    });

    it('should handle error response without body', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: () => Promise.reject(new Error('No JSON')),
      });

      await expect(api.get('/api/missing')).rejects.toThrow('HTTP 404');
    });

    it('should throw for 400 Bad Request', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ error: 'Invalid input' }),
      });

      await expect(api.post('/api/items', {})).rejects.toThrow('Invalid input');
    });

    it('should throw for 403 Forbidden', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: () => Promise.resolve({ error: 'Access denied' }),
      });

      await expect(api.get('/api/admin')).rejects.toThrow('Access denied');
    });
  });

  describe('headers', () => {
    it('should set Content-Type header when body is present', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
      });

      await api.post('/api/test', { data: 'value' });

      const headers = mockFetch.mock.calls[0][1]?.headers as Headers;
      expect(headers.get('Content-Type')).toBe('application/json');
    });

    it('should not set Content-Type header when no body', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
      });

      await api.get('/api/test');

      const headers = mockFetch.mock.calls[0][1]?.headers as Headers;
      expect(headers.get('Content-Type')).toBeNull();
    });

    it('should set X-Request-ID header', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
      });

      await api.get('/api/test');

      const headers = mockFetch.mock.calls[0][1]?.headers as Headers;
      expect(headers.get('X-Request-ID')).toBe('mock-uuid-123');
    });
  });

  describe('rawFetch', () => {
    it('returns the raw Response with auth + X-Request-ID headers applied', async () => {
      const response = { ok: true, status: 200 };
      mockFetch.mockResolvedValueOnce(response);
      api.setToken('tok');

      const res = await api.rawFetch('/api/pcap/x/download');

      expect(res).toBe(response);
      const headers = mockFetch.mock.calls[0][1]?.headers as Headers;
      expect(headers.get('Authorization')).toBe('Bearer tok');
      expect(headers.get('X-Request-ID')).toBe('mock-uuid-123');
      // No JSON Content-Type is forced for raw requests.
      expect(headers.get('Content-Type')).toBeNull();
    });

    it('returns non-ok (non-401) responses without throwing so the caller can read the body', async () => {
      const response = { ok: false, status: 500 };
      mockFetch.mockResolvedValueOnce(response);

      await expect(api.rawFetch('/api/x')).resolves.toBe(response);
    });

    it('clears the token and dispatches auth:expired on 401', async () => {
      const eventSpy = vi.fn();
      window.addEventListener('auth:expired', eventSpy);
      mockFetch.mockResolvedValueOnce({ ok: false, status: 401 });
      api.setToken('expired-token');

      await expect(api.rawFetch('/api/x')).rejects.toThrow('Session expired');
      expect(api.getToken()).toBeNull();
      expect(eventSpy).toHaveBeenCalled();

      window.removeEventListener('auth:expired', eventSpy);
    });
  });

  describe('downloadBlob', () => {
    let createObjectURLSpy: ReturnType<typeof vi.fn>;
    let revokeObjectURLSpy: ReturnType<typeof vi.fn>;
    let clickSpy: ReturnType<typeof vi.spyOn>;
    let originalCreate: typeof URL.createObjectURL;
    let originalRevoke: typeof URL.revokeObjectURL;
    let lastDownloadName: string | undefined;

    beforeEach(() => {
      lastDownloadName = undefined;
      originalCreate = URL.createObjectURL;
      originalRevoke = URL.revokeObjectURL;
      createObjectURLSpy = vi.fn(() => 'blob:mock-url');
      revokeObjectURLSpy = vi.fn();
      URL.createObjectURL = createObjectURLSpy as unknown as typeof URL.createObjectURL;
      URL.revokeObjectURL = revokeObjectURLSpy as unknown as typeof URL.revokeObjectURL;
      clickSpy = vi
        .spyOn(HTMLAnchorElement.prototype, 'click')
        .mockImplementation(function (this: HTMLAnchorElement) {
          lastDownloadName = this.download;
        });
    });

    afterEach(() => {
      clickSpy.mockRestore();
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
    });

    it('downloads with the forced filename and revokes the object URL', async () => {
      const blob = new Blob(['data']);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        blob: () => Promise.resolve(blob),
      });

      await api.downloadBlob('/api/pcap/abc/download', { filename: 'capture_abc.pcap' });

      expect(createObjectURLSpy).toHaveBeenCalledWith(blob);
      expect(lastDownloadName).toBe('capture_abc.pcap');
      expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:mock-url');
    });

    it('prefers the Content-Disposition filename over the fallback', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'Content-Disposition': 'attachment; filename="server-name.json"' }),
        blob: () => Promise.resolve(new Blob(['{}'])),
      });

      await api.downloadBlob('/api/prompt-profiles/export', { fallbackFilename: 'prompts-export.json' });

      expect(lastDownloadName).toBe('server-name.json');
    });

    it('uses the fallback filename when no Content-Disposition is present', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        blob: () => Promise.resolve(new Blob(['{}'])),
      });

      await api.downloadBlob('/api/prompt-profiles/export', { fallbackFilename: 'prompts-export.json' });

      expect(lastDownloadName).toBe('prompts-export.json');
    });

    it('throws with the parsed error on a non-ok download', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ error: 'Capture not found' }),
      });

      await expect(
        api.downloadBlob('/api/pcap/x/download', { filename: 'x.pcap' }),
      ).rejects.toThrow('Capture not found');
    });

    it('routes an unauthorized download through the 401 → auth:expired flow', async () => {
      const eventSpy = vi.fn();
      window.addEventListener('auth:expired', eventSpy);
      mockFetch.mockResolvedValueOnce({ ok: false, status: 401 });
      api.setToken('expired-token');

      await expect(
        api.downloadBlob('/api/pcap/x/download', { filename: 'x.pcap' }),
      ).rejects.toThrow('Session expired');
      expect(api.getToken()).toBeNull();
      expect(eventSpy).toHaveBeenCalled();

      window.removeEventListener('auth:expired', eventSpy);
    });
  });
});
