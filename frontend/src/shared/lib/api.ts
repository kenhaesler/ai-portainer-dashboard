import { ApiError } from './api-error';
import { AUTH_TOKEN_KEY } from './auth-constants';

const API_BASE = import.meta.env.VITE_API_URL || '';

function describeHttpError(status: number): string {
  switch (status) {
    case 502: return 'Portainer connection failed';
    case 503: return 'Service temporarily unavailable';
    case 504: return 'Gateway timeout — Portainer did not respond';
    default: return `HTTP ${status}`;
  }
}

interface RequestOptions extends RequestInit {
  params?: Record<string, string | number | boolean | undefined>;
  timeoutMs?: number;
}

class ApiClient {
  private token: string | null = null;

  constructor() {
    this.token = this.readStoredToken();
  }

  private readStoredToken(): string | null {
    try {
      return window.localStorage.getItem(AUTH_TOKEN_KEY);
    } catch {
      return null;
    }
  }

  setToken(token: string | null) {
    this.token = token;
  }

  getToken(): string | null {
    return this.token;
  }

  private buildUrl(path: string, params?: Record<string, string | number | boolean | undefined>): string {
    const url = new URL(path, API_BASE || window.location.origin);
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          url.searchParams.append(key, String(value));
        }
      });
    }
    return url.toString();
  }

  async request<T>(
    path: string,
    options: RequestOptions = {}
  ): Promise<T> {
    const { params, timeoutMs = 30000, ...fetchOptions } = options;
    const headers = new Headers(fetchOptions.headers);
    if (fetchOptions.body) {
      headers.set('Content-Type', 'application/json');
    }
    headers.set('X-Request-ID', crypto.randomUUID());

    if (this.token) {
      headers.set('Authorization', `Bearer ${this.token}`);
    }

    const url = this.buildUrl(path, params);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      response = await fetch(url, {
        ...fetchOptions,
        headers,
        signal: fetchOptions.signal ?? controller.signal,
      });
    } catch (err) {
      clearTimeout(timeout);
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new Error('Request timed out — server did not respond', { cause: err });
      }
      throw new Error('Network error — check your connection', { cause: err });
    } finally {
      clearTimeout(timeout);
    }

    const requestId = headers.get('X-Request-ID') ?? undefined;

    if (response.status === 401) {
      this.token = null;
      window.dispatchEvent(new CustomEvent('auth:expired'));
      throw new ApiError(401, 'Session expired', requestId);
    }

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      const fallback = describeHttpError(response.status);
      // Fastify default error shape is { statusCode, error: 'Internal Server Error', message: 'actual cause' }.
      // Prefer body.message so the underlying cause surfaces instead of the generic class name.
      // Custom routes that send { error: 'msg' } still work via the fallback.
      const detail = body.message || body.error || fallback;
      throw new ApiError(response.status, detail, requestId);
    }

    return response.json();
  }

  get<T>(path: string, options?: { params?: Record<string, string | number | boolean | undefined>; signal?: AbortSignal }) {
    return this.request<T>(path, { method: 'GET', ...options });
  }

  post<T>(path: string, body?: unknown, options?: { timeoutMs?: number }) {
    return this.request<T>(path, {
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
      timeoutMs: options?.timeoutMs,
    });
  }

  put<T>(path: string, body?: unknown) {
    return this.request<T>(path, {
      method: 'PUT',
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  patch<T>(path: string, body?: unknown) {
    return this.request<T>(path, {
      method: 'PATCH',
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  delete<T>(path: string, options?: { body?: unknown; params?: Record<string, string | number | boolean | undefined> }) {
    return this.request<T>(path, {
      method: 'DELETE',
      params: options?.params,
      body: options?.body ? JSON.stringify(options.body) : undefined,
    });
  }
}

export const api = new ApiClient();
