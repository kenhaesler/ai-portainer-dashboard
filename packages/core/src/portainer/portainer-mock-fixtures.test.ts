import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { z } from 'zod/v4';
import {
  EndpointArraySchema,
  EndpointSchema,
  ContainerArraySchema,
  ContainerInspectSchema,
  StackSchema,
  NetworkSchema,
  ImageSchema,
} from '../models/portainer.js';
import {
  normalizeEndpoint,
  applyLiveDockerInfo,
  normalizeContainer,
  normalizeStack,
} from './portainer-normalizers.js';

const here = dirname(fileURLToPath(import.meta.url)); // packages/core/src/portainer
const filesDir = join(here, '../../../../docker/portainer-mock/__files');
const readFixture = (name: string): unknown =>
  JSON.parse(readFileSync(join(filesDir, name), 'utf8'));

describe('portainer-mock fixtures match the backend contract', () => {
  it('endpoints.json parses and yields a live-capable Docker endpoint', () => {
    const endpoints = EndpointArraySchema.parse(readFixture('endpoints.json'));
    expect(endpoints.length).toBeGreaterThanOrEqual(1);
    const ep = endpoints.map(normalizeEndpoint)[0];
    expect(ep.id).toBe(1);
    expect(ep.type).toBe(1);
    expect(ep.status).toBe('up');
    expect(ep.isEdge).toBe(false);
  });

  it('endpoint.json (single) parses', () => {
    const ep = normalizeEndpoint(EndpointSchema.parse(readFixture('endpoint.json')));
    expect(ep.id).toBe(1);
  });

  it('docker-info.json drives live container counts', () => {
    const info = readFixture('docker-info.json') as {
      Containers: number; ContainersRunning: number; ContainersStopped: number; ContainersPaused: number;
    };
    const base = normalizeEndpoint(EndpointArraySchema.parse(readFixture('endpoints.json'))[0]);
    const live = applyLiveDockerInfo(base, {
      containers: info.Containers,
      containersRunning: info.ContainersRunning,
      containersStopped: info.ContainersStopped,
      containersPaused: info.ContainersPaused,
      ncpu: 4,
      memTotal: 8_000_000_000,
      fetchedAt: Date.now(),
    });
    expect(live.snapshotSource).toBe('live');
    expect(live.totalContainers).toBe(info.Containers);
    expect(live.containersRunning).toBe(info.ContainersRunning);
  });

  it('containers.json parses, normalizes, and includes compose-grouped + mixed-state containers', () => {
    const containers = ContainerArraySchema.parse(readFixture('containers.json')).map((c) =>
      normalizeContainer(c, 1, 'ci-docker'),
    );
    expect(containers.length).toBeGreaterThanOrEqual(2);
    expect(containers.some((c) => c.state === 'running')).toBe(true);
    // 'exited' State normalizes to 'stopped' in NormalizedContainer
    expect(containers.some((c) => c.state === 'stopped')).toBe(true);
    expect(containers.every((c) => !c.name.startsWith('/'))).toBe(true);
    const projects = new Set(
      containers.map((c) => c.labels?.['com.docker.compose.project']).filter(Boolean),
    );
    expect(projects.size).toBeGreaterThanOrEqual(2);
  });

  it('container-inspect.json parses with the inspect schema', () => {
    const inspect = ContainerInspectSchema.parse(readFixture('container-inspect.json'));
    expect(inspect.Id).toBeTruthy();
    expect(inspect.State?.Running).toBe(true);
    expect(inspect.Config?.Labels?.['com.docker.compose.project']).toBe('shop');
  });

  it('stacks.json parses, normalizes, and links to endpoint 1', () => {
    const stacks = z.array(StackSchema).parse(readFixture('stacks.json')).map(normalizeStack);
    expect(stacks.length).toBeGreaterThanOrEqual(1);
    expect(stacks.some((s) => s.endpointId === 1)).toBe(true);
    expect(stacks.map((s) => s.name)).toEqual(expect.arrayContaining(['shop', 'infra']));
  });

  it('networks.json and images.json parse', () => {
    expect(z.array(NetworkSchema).parse(readFixture('networks.json')).length).toBeGreaterThanOrEqual(1);
    expect(z.array(ImageSchema).parse(readFixture('images.json')).length).toBeGreaterThanOrEqual(1);
  });
});

const mappingsDir = join(here, '../../../../docker/portainer-mock/mappings');

interface Mapping {
  request: { method: string; urlPath?: string; urlPathPattern?: string };
  response: { status: number; bodyFileName?: string; body?: string };
}

function loadMappings(): Mapping[] {
  return readdirSync(mappingsDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(mappingsDir, f), 'utf8')) as Mapping);
}

function matches(m: Mapping, method: string, path: string): boolean {
  if (m.request.method !== method) return false;
  if (m.request.urlPath) return m.request.urlPath === path;
  if (m.request.urlPathPattern) {
    // Patterns are our own fixed in-repo mapping strings, not user input — ReDoS risk is nil.
    // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp
    return new RegExp(`^${m.request.urlPathPattern}$`).test(path);
  }
  return false;
}

describe('portainer-mock WireMock mappings', () => {
  const mappings = loadMappings();

  it('every mapping is well-formed and its bodyFileName exists', () => {
    expect(mappings.length).toBeGreaterThanOrEqual(8);
    for (const m of mappings) {
      expect(m.request.method).toBe('GET');
      expect(Boolean(m.request.urlPath) || Boolean(m.request.urlPathPattern)).toBe(true);
      expect(m.response.status).toBe(200);
      if (m.response.bodyFileName) {
        readFixture(m.response.bodyFileName); // throws if the referenced body file is missing
      }
    }
  });

  it('covers every read path the E2E pages need (exactly one match each)', () => {
    const required: Array<[string, string]> = [
      ['GET', '/api/endpoints'],
      ['GET', '/api/endpoints/1'],
      ['GET', '/api/endpoints/1/docker/_ping'],
      ['GET', '/api/endpoints/1/docker/info'],
      ['GET', '/api/endpoints/1/docker/containers/json'],
      ['GET', '/api/endpoints/1/docker/containers/a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2/json'],
      ['GET', '/api/stacks'],
      ['GET', '/api/endpoints/1/docker/networks'],
      ['GET', '/api/endpoints/1/docker/images/json'],
    ];
    for (const [method, path] of required) {
      const hits = mappings.filter((m) => matches(m, method, path));
      expect(hits.length, `${method} ${path} should match exactly one mapping`).toBe(1);
    }
  });
});
