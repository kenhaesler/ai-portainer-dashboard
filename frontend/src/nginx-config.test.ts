import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('nginx hardening config', () => {
  it('disables server token disclosure and sets default vhost explicitly', () => {
    const nginxPath = path.resolve(process.cwd(), 'nginx.conf');
    const config = fs.readFileSync(nginxPath, 'utf8');

    expect(config).toContain('server_tokens off;');
    expect(config).toContain('listen 8080 default_server;');
  });

  it('serves the SPA for the bare /health route instead of proxying to the backend (#1420)', () => {
    const nginxPath = path.resolve(process.cwd(), 'nginx.conf');
    const config = fs.readFileSync(nginxPath, 'utf8');

    // Exact-match location so a direct navigation/refresh of the SPA Health
    // page serves index.html and is never 301'd into the /health/ backend proxy.
    expect(config).toMatch(
      /location\s*=\s*\/health\s*\{[^}]*try_files\s+\/index\.html/s,
    );
    // The /health/ sub-path backend liveness proxy is preserved.
    expect(config).toContain('location /health/');
  });
});
