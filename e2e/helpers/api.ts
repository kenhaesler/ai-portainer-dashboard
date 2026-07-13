import { request, type APIRequestContext } from '@playwright/test';

/**
 * Backend REST base URL. In both the CI compose stack and local `docker compose`
 * runs the backend is published on 127.0.0.1:3051 (see docker-compose.yml), and
 * the Vite dev server / nginx also proxy `/api` there — so hitting the backend
 * directly is portable. Mirrors the hard-coded URL in global-setup.ts. Override
 * with E2E_BACKEND_URL if the backend is elsewhere.
 */
export const BACKEND_URL = process.env.E2E_BACKEND_URL ?? 'http://localhost:3051';

export const ADMIN_USERNAME = process.env.E2E_USERNAME ?? 'admin';
export const ADMIN_PASSWORD = process.env.E2E_PASSWORD ?? 'changeme12345';

/** Log in via the REST API and return the signed JWT. */
export async function apiLogin(username: string, password: string): Promise<string> {
  const ctx = await request.newContext({ baseURL: BACKEND_URL });
  try {
    const res = await ctx.post('/api/auth/login', { data: { username, password } });
    if (!res.ok()) {
      throw new Error(`Login for "${username}" failed (${res.status()}): ${await res.text()}`);
    }
    const body = (await res.json()) as { token: string };
    return body.token;
  } finally {
    await ctx.dispose();
  }
}

/** A REST context that sends `Authorization: Bearer <token>` on every request. */
export function authedContext(token: string): Promise<APIRequestContext> {
  return request.newContext({
    baseURL: BACKEND_URL,
    extraHTTPHeaders: { Authorization: `Bearer ${token}` },
  });
}
