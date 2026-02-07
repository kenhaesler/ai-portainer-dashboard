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
});
