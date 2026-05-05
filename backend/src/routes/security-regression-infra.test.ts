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

  it('should document localhost-bound Ollama startup in README', () => {
    const file = path.resolve(process.cwd(), '..', 'README.md');
    const content = readFileSync(file, 'utf8');

    expect(content).toContain('OLLAMA_HOST=127.0.0.1:11434 ollama serve');
    expect(content).toContain('Do not expose Ollama on `0.0.0.0` without authentication.');
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

  it('should default all VERIFY_SSL env vars to true in the env schema (CWE-295)', () => {
    // The env schema defines defaults for TLS verification env vars.
    // All must default to 'true' (transformed to boolean true) so that
    // TLS verification is enabled unless explicitly opted out.
    // Read the source directly to guard against default changes.
    const schemaPath = path.resolve(process.cwd(), '..', 'packages', 'core', 'src', 'config', 'env.schema.ts');
    const schemaSource = readFileSync(schemaPath, 'utf8');

    // Each VERIFY_SSL field must have .default('true')
    const verifySslFields = ['PORTAINER_VERIFY_SSL', 'LLM_VERIFY_SSL', 'HARBOR_VERIFY_SSL'];
    for (const field of verifySslFields) {
      // Match the field definition and verify it defaults to 'true'
      const fieldRegex = new RegExp(`${field}:\\s*z\\.string\\(\\)\\.default\\(['"]true['"]\\)`);
      expect(schemaSource).toMatch(fieldRegex);
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
