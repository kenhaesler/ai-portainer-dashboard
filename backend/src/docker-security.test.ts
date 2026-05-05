import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

const ROOT = resolve(__dirname, '../..');

function readFile(relativePath: string): string {
  return readFileSync(resolve(ROOT, relativePath), 'utf-8');
}

function readCompose(): {
  services: Record<string, { ports?: string[] | undefined }>;
} {
  return parseYaml(readFile('docker/docker-compose.yml')) as {
    services: Record<string, { ports?: string[] | undefined }>;
  };
}

function readLines(relativePath: string): string[] {
  return readFile(relativePath)
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
}

describe('Dockerfile security best practices', () => {
  describe('backend/Dockerfile (production)', () => {
    const content = readFile('backend/Dockerfile');

    it('uses multi-stage build', () => {
      const fromStatements = content.match(/^FROM\s/gm);
      expect(fromStatements?.length).toBeGreaterThanOrEqual(2);
    });

    it('runtime stage uses non-dev DHI image', () => {
      // The final runtime stage must use a hardened (non-dev) DHI image
      expect(content).toMatch(/FROM\s+dhi\.io\/node:\S+\s+AS\s+runtime/m);
      // Runtime image must NOT be a -dev variant
      const runtimeFrom = content.match(/FROM\s+(dhi\.io\/node:\S+)\s+AS\s+runtime/m);
      expect(runtimeFrom?.[1]).not.toMatch(/-dev/);
    });

    it('runs as non-root user', () => {
      expect(content).toMatch(/^USER\s+\S+/m);
    });

    it('has a healthcheck', () => {
      expect(content).toMatch(/^HEALTHCHECK\s/m);
    });

    it('uses npm ci for reproducible builds', () => {
      expect(content).toMatch(/npm ci/);
    });

    it('sets NODE_ENV=production', () => {
      expect(content).toMatch(/NODE_ENV=production/);
    });

    it('uses dumb-init for PID 1', () => {
      expect(content).toMatch(/dumb-init/);
    });
  });

  describe('frontend/Dockerfile (production)', () => {
    const content = readFile('frontend/Dockerfile');

    it('uses multi-stage build', () => {
      const fromStatements = content.match(/^FROM\s/gm);
      expect(fromStatements?.length).toBeGreaterThanOrEqual(2);
    });

    it('runtime stage uses non-dev DHI image', () => {
      expect(content).toMatch(/FROM\s+dhi\.io\/nginx:\S+\s+AS\s+runtime/m);
      const runtimeFrom = content.match(/FROM\s+(dhi\.io\/nginx:\S+)\s+AS\s+runtime/m);
      expect(runtimeFrom?.[1]).not.toMatch(/-dev/);
    });

    it('runs as non-root user (explicit USER or DHI nonroot default)', () => {
      // DHI hardened images run as nonroot by default — an explicit USER
      // directive is not required when the runtime base is a DHI image.
      const hasUserDirective = /^USER\s+\S+/m.test(content);
      const usesDhiRuntime = /FROM\s+dhi\.io\/\S+\s+AS\s+runtime/m.test(content);
      expect(hasUserDirective || usesDhiRuntime).toBe(true);
    });

    it('has a healthcheck', () => {
      expect(content).toMatch(/^HEALTHCHECK\s/m);
    });

    it('uses npm ci for reproducible builds', () => {
      expect(content).toMatch(/npm ci/);
    });
  });

  describe('backend/Dockerfile.dev', () => {
    const content = readFile('backend/Dockerfile.dev');

    it('drops privileges via entrypoint (su-exec to node user)', () => {
      expect(content).toMatch(/su-exec/);
      expect(content).toMatch(/docker-entrypoint\.sh/);
    });

    it('has a healthcheck', () => {
      expect(content).toMatch(/^HEALTHCHECK\s/m);
    });

    it('uses dumb-init for PID 1', () => {
      expect(content).toMatch(/dumb-init/);
    });
  });

  describe('backend/docker-entrypoint.sh', () => {
    const content = readFile('backend/docker-entrypoint.sh');

    it('fixes data directory ownership', () => {
      expect(content).toMatch(/chown.*node.*\/app\/data/);
    });

    it('drops to non-root user via su-exec', () => {
      expect(content).toMatch(/exec su-exec node/);
    });
  });

  describe('frontend/Dockerfile.dev', () => {
    const content = readFile('frontend/Dockerfile.dev');

    it('runs as non-root user', () => {
      expect(content).toMatch(/^USER\s+\S+/m);
    });

    it('has a healthcheck', () => {
      expect(content).toMatch(/^HEALTHCHECK\s/m);
    });
  });
});

describe('.dockerignore security', () => {
  const requiredEntries = [
    'node_modules',
    '.env',
    '.env.*',
    '.git',
  ];

  describe('backend/.dockerignore', () => {
    const entries = readLines('backend/.dockerignore');

    for (const entry of requiredEntries) {
      it(`excludes ${entry}`, () => {
        expect(entries).toContain(entry);
      });
    }

    it('excludes data directory', () => {
      expect(entries.some((e) => e === 'data/' || e === 'data')).toBe(true);
    });
  });

  describe('frontend/.dockerignore', () => {
    const entries = readLines('frontend/.dockerignore');

    for (const entry of requiredEntries) {
      it(`excludes ${entry}`, () => {
        expect(entries).toContain(entry);
      });
    }
  });
});

/**
 * Returns true if `line` is a top-level service key (exactly 2-space indent,
 * a single identifier, then a colon, optional trailing whitespace, nothing else).
 * Implemented with string ops rather than dynamic regex to avoid ReDoS surface.
 */
function isServiceKeyLine(line: string): boolean {
  if (!line.startsWith('  ') || line.startsWith('   ')) return false;
  const rest = line.slice(2);
  const colonIdx = rest.indexOf(':');
  if (colonIdx <= 0) return false;
  const ident = rest.slice(0, colonIdx);
  if (!/^[A-Za-z0-9_-]+$/.test(ident)) return false;
  return rest.slice(colonIdx + 1).trim() === '';
}

/**
 * Returns true if `line` is a service-body key (exactly 4-space indent,
 * single identifier, colon, optional trailing whitespace).
 */
function isFieldKeyLine(line: string): boolean {
  if (!line.startsWith('    ') || line.startsWith('     ')) return false;
  const rest = line.slice(4);
  const colonIdx = rest.indexOf(':');
  if (colonIdx <= 0) return false;
  const ident = rest.slice(0, colonIdx);
  if (!/^[A-Za-z0-9_-]+$/.test(ident)) return false;
  return rest.slice(colonIdx + 1).trim() === '';
}

/**
 * Extracts the YAML block for a given top-level service from
 * `docker/docker-compose.yml`. We rely on the indentation contract:
 *   - service keys are indented by exactly 2 spaces
 *   - their bodies are indented by 4+ spaces
 * The block ends at the next 2-space-indented key or EOF.
 */
function getComposeServiceBlock(serviceName: string): string {
  const content = readFile('docker/docker-compose.yml');
  const lines = content.split('\n');
  const header = `  ${serviceName}:`;
  const start = lines.findIndex((l) => l === header || l === header + ' ');
  if (start === -1) {
    throw new Error(`Service "${serviceName}" not found in docker/docker-compose.yml`);
  }
  const after = lines.slice(start + 1);
  const endRel = after.findIndex((l) => isServiceKeyLine(l));
  const end = endRel === -1 ? lines.length : start + 1 + endRel;
  return lines.slice(start, end).join('\n');
}

/**
 * Within a single service block, returns the lines belonging to the named
 * top-level key (e.g. "cap_drop", "cap_add", "security_opt") as a flat
 * array of trimmed list-item values. The key is at 4-space indent inside
 * the block; its list items are at 6-space indent with `- ` prefix.
 * Returns `null` if the key is not present.
 */
function getServiceListField(block: string, fieldName: string): string[] | null {
  const lines = block.split('\n');
  const header = `    ${fieldName}:`;
  const start = lines.findIndex((l) => l === header || l === header + ' ');
  if (start === -1) return null;
  const items: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('      - ')) {
      // Strip inline comments and trailing whitespace
      items.push(line.slice(8).replace(/\s+#.*$/, '').trim());
      continue;
    }
    if (isFieldKeyLine(line)) break;
    if (line.trim() === '') continue;
    // Any other content terminates the list (e.g. dedent to next service)
    break;
  }
  return items;
}

describe('docker/docker-compose.yml capability hardening', () => {
  // Services that SHOULD have cap_drop: [ALL]
  const cappedServices = ['backend', 'frontend', 'postgres-app', 'timescaledb'];

  for (const svc of cappedServices) {
    describe(`${svc}`, () => {
      const block = getComposeServiceBlock(svc);

      it('drops ALL Linux capabilities', () => {
        const capDrop = getServiceListField(block, 'cap_drop');
        expect(capDrop).not.toBeNull();
        expect(capDrop).toEqual(['ALL']);
      });
    });
  }

  describe('backend', () => {
    const block = getComposeServiceBlock('backend');

    it('does NOT request any cap_add (non-root, port >1024)', () => {
      expect(getServiceListField(block, 'cap_add')).toBeNull();
    });

    it('sets no-new-privileges:true (no privilege transition needed)', () => {
      expect(getServiceListField(block, 'security_opt')).toEqual(['no-new-privileges:true']);
    });
  });

  describe('frontend', () => {
    const block = getComposeServiceBlock('frontend');

    it('does NOT request any cap_add (nginx as nonroot on port 8080)', () => {
      expect(getServiceListField(block, 'cap_add')).toBeNull();
    });

    it('sets no-new-privileges:true (no privilege transition needed)', () => {
      expect(getServiceListField(block, 'security_opt')).toEqual(['no-new-privileges:true']);
    });
  });

  // postgres-app and timescaledb both run the postgres entrypoint that uses
  // `gosu` to switch from root → postgres at startup. `no-new-privileges:true`
  // would block that transition, so it MUST be omitted on these two services.
  // They share the same minimal cap_add allowlist instead.
  const postgresServices = ['postgres-app', 'timescaledb'] as const;
  const postgresExpectedCapAdd = ['CHOWN', 'DAC_OVERRIDE', 'FOWNER', 'SETUID', 'SETGID'];

  for (const svc of postgresServices) {
    describe(`${svc}`, () => {
      const block = getComposeServiceBlock(svc);

      it('does NOT set no-new-privileges (gosu requires privilege transition)', () => {
        const securityOpt = getServiceListField(block, 'security_opt');
        // Either the field is absent entirely, or present without no-new-privileges.
        if (securityOpt !== null) {
          expect(securityOpt).not.toContain('no-new-privileges:true');
        }
      });

      it('adds the minimal cap set for postgres entrypoint (gosu + chown init)', () => {
        const capAdd = getServiceListField(block, 'cap_add');
        expect(capAdd).not.toBeNull();
        expect([...(capAdd ?? [])].sort()).toEqual([...postgresExpectedCapAdd].sort());
      });
    });
  }

  it('postgres-app and timescaledb share the same cap_add set', () => {
    const a = getServiceListField(getComposeServiceBlock('postgres-app'), 'cap_add');
    const b = getServiceListField(getComposeServiceBlock('timescaledb'), 'cap_add');
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect([...(a ?? [])].sort()).toEqual([...(b ?? [])].sort());
  });

  // Regression guard for the B1 audit (CRITIC-FINDINGS §A1).
  // These two services were investigated and confirmed compatible with
  // `no-new-privileges:true`. They MUST NOT be modified by this PR.
  // See /tmp/issue-plans/B1-AUDIT.md for the full investigation.
  describe('B1 audit regression guard (services intentionally NOT modified)', () => {
    it('timescale-backup retains no-new-privileges:true (entrypoint runs as root, no gosu)', () => {
      const block = getComposeServiceBlock('timescale-backup');
      expect(getServiceListField(block, 'security_opt')).toEqual(['no-new-privileges:true']);
      // Must NOT have inherited the timescaledb cap_drop+cap_add pattern.
      expect(getServiceListField(block, 'cap_drop')).toBeNull();
      expect(getServiceListField(block, 'cap_add')).toBeNull();
    });

    it('kali-mcp retains no-new-privileges:true (USER appuser at build time)', () => {
      const block = getComposeServiceBlock('kali-mcp');
      expect(getServiceListField(block, 'security_opt')).toEqual(['no-new-privileges:true']);
      // Pre-existing cap_add (non-functional for non-root USER without setcap)
      // is intentionally left untouched here; addressing it is a separate Dockerfile
      // change tracked outside this PR.
      expect(getServiceListField(block, 'cap_add')).toEqual(['NET_RAW', 'NET_ADMIN']);
    });
  });
});

describe('docker/docker-compose.yml port bindings (#1113)', () => {
  // Production compose must publish ports to localhost only — direct external
  // exposure is gated by a host-level reverse proxy (Traefik/nginx). LAN-direct
  // deployments can override via docker-compose.override.yml.
  const compose = readCompose();

  it('frontend service binds port 8080 to 127.0.0.1 only', () => {
    const ports = compose.services.frontend?.ports ?? [];
    expect(ports).toHaveLength(1);
    expect(ports[0]).toBe('127.0.0.1:8080:8080');
    // Defence-in-depth: explicitly reject the two unsafe forms.
    expect(ports[0]).not.toBe('8080:8080');
    expect(ports[0]).not.toMatch(/^0\.0\.0\.0:/);
  });

  it('backend service binds port 3051 to 127.0.0.1 only (regression guard)', () => {
    const ports = compose.services.backend?.ports ?? [];
    expect(ports).toHaveLength(1);
    expect(ports[0]).toBe('127.0.0.1:3051:3051');
    expect(ports[0]).not.toMatch(/^0\.0\.0\.0:/);
  });
});

// Issue #1121 — Docker Secrets migration assertions on the production compose.
// These are line-anchored checks rather than full YAML parsing because the
// repo doesn't depend on `yaml` and the existing compose-security tests in
// this file/`*-compose-security.test.ts` use the same string-matching style.
describe('Docker Secrets migration (#1121)', () => {
  const compose = readFile('docker/docker-compose.yml');

  /**
   * Slice a service block out of the compose file by name. Returns the lines
   * between `  <name>:` (2-space indent — top-level service) and the next
   * top-level key (a line starting with two spaces followed by a non-space
   * character at the same indent, OR a line with no leading space).
   */
  function getServiceBlock(name: string): string {
    const lines = compose.split('\n');
    const startIdx = lines.findIndex((l) => l === `  ${name}:`);
    expect(startIdx).toBeGreaterThanOrEqual(0);
    const endIdx = lines.findIndex(
      (l, i) => i > startIdx && /^(\S| {2}\S)/.test(l) && !/^ {2}\s/.test(l),
    );
    return lines.slice(startIdx, endIdx === -1 ? undefined : endIdx).join('\n');
  }

  it('defines all four secrets in the top-level secrets: block', () => {
    // Top-level `secrets:` (no leading whitespace, with file: refs)
    expect(compose).toMatch(/^secrets:\s*$/m);
    expect(compose).toMatch(/^\s+jwt_secret:\s*\n\s+file:\s+\.\/secrets\/jwt_secret\.txt/m);
    expect(compose).toMatch(/^\s+postgres_app_password:\s*\n\s+file:\s+\.\/secrets\/postgres_app_password\.txt/m);
    expect(compose).toMatch(/^\s+timescale_password:\s*\n\s+file:\s+\.\/secrets\/timescale_password\.txt/m);
    expect(compose).toMatch(/^\s+redis_password:\s*\n\s+file:\s+\.\/secrets\/redis_password\.txt/m);
  });

  it('backend service references all four secrets', () => {
    const block = getServiceBlock('backend');
    expect(block).toMatch(/^ {4}secrets:\s*$/m);
    expect(block).toMatch(/^\s+- jwt_secret$/m);
    expect(block).toMatch(/^\s+- postgres_app_password$/m);
    expect(block).toMatch(/^\s+- timescale_password$/m);
    expect(block).toMatch(/^\s+- redis_password$/m);
  });

  it('postgres-app references postgres_app_password and uses POSTGRES_PASSWORD_FILE', () => {
    const block = getServiceBlock('postgres-app');
    expect(block).toMatch(/POSTGRES_PASSWORD_FILE:\s+\/run\/secrets\/postgres_app_password/);
    expect(block).toMatch(/^ {4}secrets:\s*$/m);
    expect(block).toMatch(/^\s+- postgres_app_password$/m);
  });

  it('timescaledb references timescale_password and uses POSTGRES_PASSWORD_FILE', () => {
    const block = getServiceBlock('timescaledb');
    expect(block).toMatch(/POSTGRES_PASSWORD_FILE:\s+\/run\/secrets\/timescale_password/);
    expect(block).toMatch(/^ {4}secrets:\s*$/m);
    expect(block).toMatch(/^\s+- timescale_password$/m);
  });

  it('redis references redis_password and reads it via shell wrapper (no native _FILE support)', () => {
    const block = getServiceBlock('redis');
    expect(block).toMatch(/^ {4}secrets:\s*$/m);
    expect(block).toMatch(/^\s+- redis_password$/m);
    // Redis image does not honour REDIS_PASSWORD_FILE; the wrapper must read
    // /run/secrets/redis_password and feed it to --requirepass.
    expect(block).toContain('cat /run/secrets/redis_password');
    expect(block).toContain('--requirepass');
  });

  it('does not pass JWT_SECRET as a hard-failing interpolation any more', () => {
    // Before #1121: `JWT_SECRET=${JWT_SECRET:?...}` (compose aborts if unset).
    // After: env var is optional because /run/secrets/jwt_secret takes
    // precedence inside the backend. The backend schema still rejects empty
    // resolved values.
    const block = getServiceBlock('backend');
    expect(block).not.toMatch(/JWT_SECRET=\$\{JWT_SECRET:\?/);
    expect(block).toMatch(/JWT_SECRET=\$\{JWT_SECRET:-\}/);
  });
});

// Issue #1187 — Follow-up to #1121. Two remaining gaps closed:
//  (1) timescale-backup sidecar reads its password from
//      /run/secrets/timescale_password via POSTGRES_PASSWORD_FILE (native
//      support in prodrigestivill/postgres-backup-local).
//  (2) Backend's POSTGRES_APP_URL / TIMESCALE_URL / REDIS_URL are no longer
//      reconstructed via env-var interpolation in compose. Components
//      (HOST/PORT/USER/DATABASE) come from env, password from the secret
//      file, and the URL is assembled inside the backend's config layer.
describe('Docker Secrets follow-up (#1187)', () => {
  const compose = readFile('docker/docker-compose.yml');

  function getServiceBlock(name: string): string {
    const lines = compose.split('\n');
    const startIdx = lines.findIndex((l) => l === `  ${name}:`);
    expect(startIdx).toBeGreaterThanOrEqual(0);
    const endIdx = lines.findIndex(
      (l, i) => i > startIdx && /^(\S| {2}\S)/.test(l) && !/^ {2}\s/.test(l),
    );
    return lines.slice(startIdx, endIdx === -1 ? undefined : endIdx).join('\n');
  }

  describe('timescale-backup secrets migration', () => {
    const block = getServiceBlock('timescale-backup');

    it('uses POSTGRES_PASSWORD_FILE pointing at the timescale_password secret', () => {
      expect(block).toMatch(/POSTGRES_PASSWORD_FILE:\s+\/run\/secrets\/timescale_password/);
    });

    it('no longer interpolates TIMESCALE_PASSWORD as a plaintext env var', () => {
      // Before #1187: `POSTGRES_PASSWORD: ${TIMESCALE_PASSWORD:?...}` — the
      // compose interpolation would reconstruct the password into the env.
      expect(block).not.toMatch(/POSTGRES_PASSWORD:\s+\$\{TIMESCALE_PASSWORD/);
    });

    it('mounts the timescale_password secret', () => {
      expect(block).toMatch(/^ {4}secrets:\s*$/m);
      expect(block).toMatch(/^\s+- timescale_password$/m);
    });

    it('preserves the no-new-privileges hardening from the B1 audit', () => {
      // Regression guard for the #1121 B1 audit — this PR must NOT regress
      // the security_opt setting on the backup sidecar.
      expect(block).toMatch(/^ {4}security_opt:\s*$/m);
      expect(block).toMatch(/no-new-privileges:true/);
    });
  });

  describe('backend URL components (no password in compose interpolation)', () => {
    const block = getServiceBlock('backend');

    it('does not embed POSTGRES_APP_PASSWORD inside POSTGRES_APP_URL', () => {
      // Before #1187:
      //   POSTGRES_APP_URL=postgresql://app_user:${POSTGRES_APP_PASSWORD:?...}@postgres-app:5432/...
      // After: the URL is empty and assembled inside the backend.
      expect(block).not.toMatch(/POSTGRES_APP_URL=postgresql:\/\/[^$]*\$\{POSTGRES_APP_PASSWORD/);
    });

    it('does not embed TIMESCALE_PASSWORD inside TIMESCALE_URL', () => {
      expect(block).not.toMatch(/TIMESCALE_URL=postgresql:\/\/[^$]*\$\{TIMESCALE_PASSWORD/);
    });

    it('exposes POSTGRES_APP_HOST/PORT/USER/DATABASE as discrete env vars', () => {
      expect(block).toMatch(/POSTGRES_APP_HOST=\$\{POSTGRES_APP_HOST:-postgres-app\}/);
      expect(block).toMatch(/POSTGRES_APP_PORT=\$\{POSTGRES_APP_PORT:-5432\}/);
      expect(block).toMatch(/POSTGRES_APP_USER=\$\{POSTGRES_APP_USER:-app_user\}/);
      expect(block).toMatch(/POSTGRES_APP_DATABASE=\$\{POSTGRES_APP_DATABASE:-portainer_dashboard\}/);
    });

    it('exposes TIMESCALE_HOST/PORT/USER/DATABASE as discrete env vars', () => {
      expect(block).toMatch(/TIMESCALE_HOST=\$\{TIMESCALE_HOST:-timescaledb\}/);
      expect(block).toMatch(/TIMESCALE_PORT=\$\{TIMESCALE_PORT:-5432\}/);
      expect(block).toMatch(/TIMESCALE_USER=\$\{TIMESCALE_USER:-metrics_user\}/);
      expect(block).toMatch(/TIMESCALE_DATABASE=\$\{TIMESCALE_DATABASE:-metrics\}/);
    });

    it('exposes REDIS_HOST/PORT as discrete env vars', () => {
      expect(block).toMatch(/REDIS_HOST=\$\{REDIS_HOST:-redis\}/);
      expect(block).toMatch(/REDIS_PORT=\$\{REDIS_PORT:-6379\}/);
    });

    it('keeps POSTGRES_APP_PASSWORD/TIMESCALE_PASSWORD passthroughs as soft-default (file > env)', () => {
      // Backend reads via readSecret() — file at /run/secrets/* takes
      // precedence. The env-var passthrough must NOT be hard-failing
      // (`:?`) because Docker Secrets users do not set the env var.
      expect(block).toMatch(/POSTGRES_APP_PASSWORD=\$\{POSTGRES_APP_PASSWORD:-\}/);
      expect(block).toMatch(/TIMESCALE_PASSWORD=\$\{TIMESCALE_PASSWORD:-\}/);
      expect(block).not.toMatch(/POSTGRES_APP_PASSWORD=\$\{POSTGRES_APP_PASSWORD:\?/);
      expect(block).not.toMatch(/TIMESCALE_PASSWORD=\$\{TIMESCALE_PASSWORD:\?/);
    });

    it('keeps POSTGRES_APP_URL / TIMESCALE_URL / REDIS_URL as overridable empty defaults', () => {
      // Components take precedence inside the backend, but the dev/legacy
      // single-string path still works when an operator sets the URL env
      // var explicitly. The default must be empty — never embed a password.
      expect(block).toMatch(/POSTGRES_APP_URL=\$\{POSTGRES_APP_URL:-\}/);
      expect(block).toMatch(/TIMESCALE_URL=\$\{TIMESCALE_URL:-\}/);
      expect(block).toMatch(/REDIS_URL=\$\{REDIS_URL:-\}/);
    });
  });
});
