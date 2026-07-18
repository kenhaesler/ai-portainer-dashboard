/**
 * Security Regression — Infrastructure / TLS / Docker
 *
 * Static, file-content assertions that don't register Fastify routes.
 * Guards against:
 *   • Host-publishing internal services (Prometheus, Redis) by default
 *   • Global TLS bypass via NODE_TLS_REJECT_UNAUTHORIZED=0
 *   • Eager construction of insecure undici dispatchers at module-load
 *   • Tool-image Dockerfiles running as root
 *
 * @see https://github.com/kenhaesler/ai-portainer-dashboard/issues/430
 * @see https://github.com/kenhaesler/ai-portainer-dashboard/issues/1188 (split)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// =====================================================================
//  INFRASTRUCTURE EXPOSURE DEFAULTS
// =====================================================================
describe('Infrastructure Exposure Defaults', () => {
  it('should not host-publish Prometheus in workloads/staging-dev.yml by default', () => {
    const file = path.resolve(process.cwd(), '..', 'workloads', 'staging-dev.yml');
    const content = readFileSync(file, 'utf8');

    expect(content).not.toMatch(/\b9090:9090\b/);
    expect(content).not.toMatch(/ports:\s*\n\s*-\s*["']?9090:9090["']?/m);
  });

  it('should enforce Redis resource limits in docker/docker-compose.yml', () => {
    const file = path.resolve(process.cwd(), '..', 'docker', 'docker-compose.yml');
    const content = readFileSync(file, 'utf8');

    expect(content).toContain('--maxmemory ${REDIS_MAXMEMORY:-512mb}');
    expect(content).toContain('mem_limit: 768M');
    expect(content).toContain('mem_reservation: 256M');
    expect(content).toMatch(/redis:\n[\s\S]*?deploy:\n[\s\S]*?resources:\n[\s\S]*?limits:\n[\s\S]*?memory: 768M/);
    expect(content).toMatch(/redis:\n[\s\S]*?deploy:\n[\s\S]*?resources:\n[\s\S]*?limits:\n[\s\S]*?cpus: "0\.5"/);
  });

  it('should require Redis auth in workloads/data-services.yml', () => {
    const file = path.resolve(process.cwd(), '..', 'workloads', 'data-services.yml');
    const content = readFileSync(file, 'utf8');

    expect(content).toContain('--requirepass ${REDIS_PASSWORD:?Set REDIS_PASSWORD in .env}');
    expect(content).toMatch(/redis-cli -a \\"\$\{REDIS_PASSWORD\}\\" ping/);
  });

  it('should document localhost-bound LLM endpoint guidance in README', () => {
    const file = path.resolve(process.cwd(), '..', 'README.md');
    const content = readFileSync(file, 'utf8');

    expect(content).toContain('OLLAMA_HOST=127.0.0.1:11434 ollama serve');
    expect(content).toMatch(/Do not expose .*on `0\.0\.0\.0`.*without authentication/);
  });
});

// =====================================================================
//  NO GLOBAL TLS OVERRIDE
// =====================================================================
describe('No Global TLS Override', () => {
  it('should never set NODE_TLS_REJECT_UNAUTHORIZED to 0 globally', () => {
    // The global override was removed in favor of per-connection undici Agent.
    // This test guards against accidental reintroduction.
    expect(process.env.NODE_TLS_REJECT_UNAUTHORIZED).not.toBe('0');
  });

  it('should scope TLS bypass to LLM connections only via undici Agent', async () => {
    // Verify the LLM service creates a per-connection agent rather than
    // modifying the global TLS setting.
    // The entry point moved to @dashboard/server — check it there.
    const indexPath = path.resolve(process.cwd(), '..', 'packages', 'server', 'src', 'index.ts');
    const content = readFileSync(indexPath, 'utf8');
    expect(content).not.toContain('NODE_TLS_REJECT_UNAUTHORIZED');
  });

  it('should default all VERIFY_SSL env vars to true in the env schema (CWE-295)', async () => {
    // All VERIFY_SSL flags must default to true so TLS verification is
    // enabled unless explicitly opted out. Asserted against the real parsed
    // schema (the flags use the shared boolStr helper since #1492).
    const { envSchema } = await import('@dashboard/core/config/env.schema.js');
    const result = envSchema.safeParse({
      DASHBOARD_USERNAME: 'admin',
      DASHBOARD_PASSWORD: 'replace-with-strong-random-passphrase',
      JWT_SECRET: 'a'.repeat(64),
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.PORTAINER_VERIFY_SSL).toBe(true);
      expect(result.data.LLM_VERIFY_SSL).toBe(true);
      expect(result.data.HARBOR_VERIFY_SSL).toBe(true);
    }
  });

  it('should never use z.coerce.boolean() in the env schema (#1492)', () => {
    // z.coerce.boolean() is Boolean(input): the strings 'false' and '0'
    // coerce to TRUE, silently inverting documented kill-switches
    // (PCAP_ENABLED=false opened the packet-capture gate). All boolean env
    // flags must go through the shared boolStr() helper.
    const schemaPath = path.resolve(process.cwd(), '..', 'packages', 'core', 'src', 'config', 'env.schema.ts');
    const schemaSource = readFileSync(schemaPath, 'utf8');
    const offending = schemaSource
      .split('\n')
      .filter((line) => line.includes('z.coerce.boolean(') && !line.trimStart().startsWith('*'));
    expect(offending).toEqual([]);
  });

  it('should parse security-relevant kill-switches set to false as OFF (#1492)', async () => {
    // Regression: these previously used z.coerce.boolean(), so an operator
    // writing FLAG=false (the documented opt-out, and what docker-compose
    // forwards by default for PCAP_ENABLED) silently ENABLED the feature.
    const { envSchema } = await import('@dashboard/core/config/env.schema.js');
    const result = envSchema.safeParse({
      DASHBOARD_USERNAME: 'admin',
      DASHBOARD_PASSWORD: 'replace-with-strong-random-passphrase',
      JWT_SECRET: 'a'.repeat(64),
      PCAP_ENABLED: 'false',
      PROMETHEUS_METRICS_ENABLED: 'false',
      WEBHOOKS_ENABLED: 'false',
      ANOMALY_AUTOTUNE_ENABLED: 'false',
      CACHE_ENABLED: '0',
      HSTS_PRELOAD: 'false',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.PCAP_ENABLED).toBe(false);
      expect(result.data.PROMETHEUS_METRICS_ENABLED).toBe(false);
      expect(result.data.WEBHOOKS_ENABLED).toBe(false);
      expect(result.data.ANOMALY_AUTOTUNE_ENABLED).toBe(false);
      expect(result.data.CACHE_ENABLED).toBe(false);
      expect(result.data.HSTS_PRELOAD).toBe(false);
    }
  });

  it('should never create insecure dispatchers at module load time (CWE-295)', () => {
    // Guard against eagerly-created Agents with rejectUnauthorized: false
    // at module scope. TLS-bypassing dispatchers must be lazily initialized
    // and gated behind env var checks.
    const filesToCheck = [
      path.resolve(process.cwd(), '..', 'packages', 'core', 'src', 'portainer', 'portainer-client.ts'),
      path.resolve(process.cwd(), '..', 'packages', 'ai-intelligence', 'src', 'services', 'llm-client.ts'),
      path.resolve(process.cwd(), '..', 'packages', 'operations', 'src', 'services', 'portainer-backup.ts'),
      path.resolve(process.cwd(), '..', 'packages', 'operations', 'src', 'routes', 'logs.ts'),
      path.resolve(process.cwd(), '..', 'packages', 'infrastructure', 'src', 'services', 'elasticsearch-log-forwarder.ts'),
    ];

    for (const filePath of filesToCheck) {
      const content = readFileSync(filePath, 'utf8');
      // Match module-level `new Agent({ connect: { rejectUnauthorized: false } })` that is NOT
      // inside a function body. A simple heuristic: lines containing both `new Agent` and
      // `rejectUnauthorized: false` that are NOT preceded by `function` on the same or prior line.
      const lines = content.split('\n');
      let insideFunctionBody = false;
      let braceDepth = 0;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Track function entry via simple heuristic
        if (/\bfunction\b/.test(line)) insideFunctionBody = true;
        for (const ch of line) {
          if (ch === '{') braceDepth++;
          if (ch === '}') braceDepth--;
        }
        if (braceDepth === 0) insideFunctionBody = false;

        if (line.includes('new Agent') && !insideFunctionBody) {
          // This line creates an Agent outside of a function — it must NOT disable TLS
          expect(line).not.toContain('rejectUnauthorized: false');
        }
      }
    }
  });
});

// =====================================================================
//  DOCKER NON-ROOT USER ENFORCEMENT (CWE-250)
// =====================================================================
describe('Docker Non-Root User Enforcement', () => {
  const toolDockerfiles = [
    'tools/kali-mcp/Dockerfile',
    'tools/snyk-mcp/Dockerfile',
    'tools/grype-mcp/Dockerfile',
    'tools/nvd-mcp/Dockerfile',
  ];

  it.each(toolDockerfiles)('%s should contain a USER directive to avoid running as root', (dockerfilePath) => {
    const file = path.resolve(process.cwd(), '..', dockerfilePath);
    const content = readFileSync(file, 'utf8');

    // USER directive must appear in the runtime stage (after the last FROM)
    // and must specify a non-root user before CMD/ENTRYPOINT.
    expect(content).toMatch(/^USER\s+(?!root)\S+/m);
  });

  it.each(toolDockerfiles)('%s should create a dedicated non-root user', (dockerfilePath) => {
    const file = path.resolve(process.cwd(), '..', dockerfilePath);
    const content = readFileSync(file, 'utf8');

    // Verify the Dockerfile creates a system user (useradd for Debian, adduser for Alpine)
    expect(content).toMatch(/useradd|adduser/);
  });
});

// =====================================================================
//  VULNERABLE DEPENDENCY FLOORS
// =====================================================================
describe('Vulnerable Dependency Floors', () => {
  // GHSA-p6gq-j5cr-w38f (High, CVSS 7.1): a message-level `raw` option bypasses
  // disableFileAccess/disableUrlAccess, enabling arbitrary file read and full-response
  // SSRF in the delivered message. The affected range is `<= 9.0.0` — note that the
  // whole 8.x line is affected, so a downgrade to any 8.x reintroduces it.
  // @see https://github.com/kenhaesler/ai-portainer-dashboard/issues/1574
  const NODEMAILER_MIN = [9, 0, 1] as const;

  const atLeast = (version: string, min: readonly [number, number, number]): boolean => {
    const parts = version.split('.').map((n) => Number.parseInt(n, 10));
    for (let i = 0; i < min.length; i++) {
      const part = parts[i] ?? 0;
      if (part > min[i]) return true;
      if (part < min[i]) return false;
    }
    return true;
  };

  it('should declare a nodemailer range that cannot resolve to a vulnerable version', () => {
    const file = path.resolve(process.cwd(), '..', 'packages', 'operations', 'package.json');
    const manifest = JSON.parse(readFileSync(file, 'utf8')) as {
      dependencies?: Record<string, string>;
    };

    const range = manifest.dependencies?.nodemailer;
    expect(range).toBeDefined();

    // A caret range's floor is its lower bound, so ^9.0.1 can never resolve below 9.0.1.
    const floor = range!.replace(/^[\^~>=v\s]+/, '');
    expect(atLeast(floor, NODEMAILER_MIN)).toBe(true);
  });

  it('should resolve nodemailer above the GHSA-p6gq-j5cr-w38f patch floor in the lockfile', () => {
    const file = path.resolve(process.cwd(), '..', 'package-lock.json');
    const lock = JSON.parse(readFileSync(file, 'utf8')) as {
      packages: Record<string, { version?: string }>;
    };

    // Guard every copy in the tree, not just the hoisted one — a nested entry that
    // violates its own manifest range still installs silently under `npm ci`.
    const resolved = Object.entries(lock.packages).filter(([key]) =>
      key.endsWith('node_modules/nodemailer'),
    );
    expect(resolved.length).toBeGreaterThan(0);

    for (const [key, entry] of resolved) {
      expect(entry.version, `${key} is inside the advisory range`).toBeDefined();
      expect(atLeast(entry.version!, NODEMAILER_MIN), `${key}@${entry.version}`).toBe(true);
    }
  });

  // GHSA-96hv-2xvq-fx4p (High, CVSS 7.5): memory-exhaustion DoS — a peer can crash a
  // ws server or client with a high volume of tiny fragments and data chunks using only
  // modest network traffic. Affected `>= 8.0.0, < 8.21.0`; 8.21.0 adds the maxFragments /
  // maxBufferedChunks caps that fix it.
  //
  // `ws` is transitive (no manifest of ours declares it), so the lockfile is the only
  // place this can be asserted. It is reachable production code: ws is the engine under
  // Socket.IO, which is the app's live transport. It reached 8.20.1 because engine.io,
  // engine.io-client and socket.io-adapter all pinned `ws: ~8.20.1` — so a downgrade of
  // any one of those three silently drags ws back into the advisory range.
  // @see https://github.com/kenhaesler/ai-portainer-dashboard/issues/1577
  const WS_MIN = [8, 21, 0] as const;

  it('should resolve ws above the GHSA-96hv-2xvq-fx4p patch floor in the lockfile', () => {
    const file = path.resolve(process.cwd(), '..', 'package-lock.json');
    const lock = JSON.parse(readFileSync(file, 'utf8')) as {
      packages: Record<string, { version?: string }>;
    };

    const resolved = Object.entries(lock.packages).filter(([key]) =>
      key.endsWith('node_modules/ws'),
    );
    expect(resolved.length).toBeGreaterThan(0);

    for (const [key, entry] of resolved) {
      expect(entry.version, `${key} is inside the advisory range`).toBeDefined();
      expect(atLeast(entry.version!, WS_MIN), `${key}@${entry.version}`).toBe(true);
    }
  });

  it('should keep the socket.io transitives on ws ranges that cannot resolve below the floor', () => {
    const file = path.resolve(process.cwd(), '..', 'package-lock.json');
    const lock = JSON.parse(readFileSync(file, 'utf8')) as {
      packages: Record<string, { dependencies?: Record<string, string> }>;
    };

    // These three are what actually pin ws. Guarding only the resolved ws version would
    // let a transitive downgrade re-pin it to ~8.20.1 on the next lockfile regeneration.
    for (const pkg of ['engine.io', 'engine.io-client', 'socket.io-adapter']) {
      const entry = lock.packages[`node_modules/${pkg}`];
      expect(entry, `${pkg} missing from lockfile`).toBeDefined();

      const range = entry!.dependencies?.ws;
      expect(range, `${pkg} no longer declares a ws dependency`).toBeDefined();

      const floor = range!.replace(/^[\^~>=v\s]+/, '');
      expect(atLeast(floor, WS_MIN), `${pkg} pins ws ${range}`).toBe(true);
    }
  });
});
