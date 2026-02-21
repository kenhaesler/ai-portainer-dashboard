import { test as setup, request } from '@playwright/test';
import path from 'path';
import fs from 'fs';

const authFile = path.join(__dirname, '.auth/user.json');

/**
 * Playwright setup project: logs in via the REST API and writes
 * the authenticated storage state to `e2e/.auth/user.json`.
 *
 * A direct API call is used instead of a browser-based login to
 * avoid cold-start race conditions where the React app hasn't fully
 * rendered when the setup project runs first in CI.
 */
setup('authenticate', async () => {
  const username = process.env.E2E_USERNAME ?? 'admin';
  const password = process.env.E2E_PASSWORD ?? 'changeme12345';
  const backendURL = 'http://localhost:3051';
  const frontendOrigin = process.env.E2E_BASE_URL ?? 'http://localhost:5273';

  const ctx = await request.newContext({ baseURL: backendURL });

  const res = await ctx.post('/api/auth/login', {
    data: { username, password },
  });

  if (!res.ok()) {
    const body = await res.text();
    throw new Error(`Login failed (${res.status()}): ${body}`);
  }

  const { token, username: returnedUsername } = await res.json() as {
    token: string;
    username: string;
  };

  // Decode role from JWT payload (mirrors logic in auth-provider.tsx)
  function decodeRole(jwt: string): string {
    try {
      const payload = JSON.parse(
        Buffer.from(jwt.split('.')[1], 'base64url').toString(),
      ) as Record<string, unknown>;
      const r = payload.role;
      return r === 'admin' || r === 'operator' || r === 'viewer' ? r : 'viewer';
    } catch {
      return 'viewer';
    }
  }

  // Write the storage state that auth-provider.tsx reads from localStorage
  fs.mkdirSync(path.dirname(authFile), { recursive: true });
  fs.writeFileSync(
    authFile,
    JSON.stringify({
      cookies: [],
      origins: [
        {
          origin: frontendOrigin,
          localStorage: [
            { name: 'auth_token', value: token },
            { name: 'auth_username', value: returnedUsername },
            { name: 'auth_role', value: decodeRole(token) },
          ],
        },
      ],
    }),
  );

  await ctx.dispose();
});
