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
      this.handleUnauthorized();
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

  /**
   * Clear the stored token and notify the app that the session has expired.
   * Shared by request(), rawFetch(), and by streaming consumers that can't route
   * through those (see use-streaming-logs). auth-provider listens for 'auth:expired'.
   */
  handleUnauthorized() {
    this.token = null;
    window.dispatchEvent(new CustomEvent('auth:expired'));
  }

  /**
   * Like request() but returns the raw Response — for blob downloads and streams that
   * can't use the JSON path. Applies the same base-URL resolution, Authorization header,
   * X-Request-ID, and 401 → auth:expired handling. Non-401 responses (including non-ok)
   * are returned as-is so the caller can read the body/stream. No timeout by default,
   * since downloads and streams outlive the JSON request timeout.
   */
  async rawFetch(
    path: string,
    options: {
      method?: string;
      params?: Record<string, string | number | boolean | undefined>;
      headers?: HeadersInit;
      body?: BodyInit;
      signal?: AbortSignal;
      timeoutMs?: number;
    } = {},
  ): Promise<Response> {
    const { method = 'GET', params, headers: initHeaders, body, signal, timeoutMs } = options;
    const headers = new Headers(initHeaders);
    if (!headers.has('X-Request-ID')) {
      headers.set('X-Request-ID', crypto.randomUUID());
    }
    if (this.token) {
      headers.set('Authorization', `Bearer ${this.token}`);
    }

    const url = this.buildUrl(path, params);

    let effectiveSignal = signal;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    if (timeoutMs != null && !signal) {
      const controller = new AbortController();
      effectiveSignal = controller.signal;
      timeout = setTimeout(() => controller.abort(), timeoutMs);
    }

    let response: Response;
    try {
      response = await fetch(url, { method, headers, body, signal: effectiveSignal });
    } finally {
      if (timeout) clearTimeout(timeout);
    }

    if (response.status === 401) {
      this.handleUnauthorized();
      throw new ApiError(401, 'Session expired', headers.get('X-Request-ID') ?? undefined);
    }

    return response;
  }

  /**
   * Download an authenticated response as a file via a temporary object URL + anchor click.
   * The download name resolves as: explicit `filename` → the response's Content-Disposition
   * → `fallbackFilename` → 'download'. Shares rawFetch's 401 → auth:expired handling.
   */
  async downloadBlob(
    path: string,
    options: {
      filename?: string;
      fallbackFilename?: string;
      params?: Record<string, string | number | boolean | undefined>;
    } = {},
  ): Promise<void> {
    const response = await this.rawFetch(path, { method: 'GET', params: options.params });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      const detail = errorBody.message || errorBody.error || `Download failed (${response.status})`;
      throw new ApiError(response.status, detail);
    }

    const filename =
      options.filename ??
      parseContentDispositionFilename(response.headers.get('Content-Disposition')) ??
      options.fallbackFilename ??
      'download';

    const blob = await response.blob();
    triggerBrowserDownload(blob, filename);
  }
}

function parseContentDispositionFilename(disposition: string | null): string | undefined {
  return disposition?.match(/filename="([^"]+)"/)?.[1];
}

function triggerBrowserDownload(blob: Blob, filename: string): void {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
}

export const api = new ApiClient();
