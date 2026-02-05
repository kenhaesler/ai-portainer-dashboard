import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { api } from './api';

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
    it('should set Content-Type header', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
      });

      await api.get('/api/test');

      const headers = mockFetch.mock.calls[0][1]?.headers as Headers;
      expect(headers.get('Content-Type')).toBe('application/json');
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
});
