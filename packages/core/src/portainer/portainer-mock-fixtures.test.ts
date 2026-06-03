import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
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
      Containers: number; ContainersRunning: number; ContainersStopped: number;
    };
    const base = normalizeEndpoint(EndpointArraySchema.parse(readFixture('endpoints.json'))[0]);
    const live = applyLiveDockerInfo(base, {
      containers: info.Containers,
      containersRunning: info.ContainersRunning,
      containersStopped: info.ContainersStopped,
      containersPaused: 0,
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
  });

  it('stacks.json parses, normalizes, and links to endpoint 1', () => {
    const stacks = z.array(StackSchema).parse(readFixture('stacks.json')).map(normalizeStack);
    expect(stacks.length).toBeGreaterThanOrEqual(1);
    expect(stacks.some((s) => s.endpointId === 1)).toBe(true);
  });

  it('networks.json and images.json parse', () => {
    expect(z.array(NetworkSchema).parse(readFixture('networks.json')).length).toBeGreaterThanOrEqual(1);
    expect(z.array(ImageSchema).parse(readFixture('images.json')).length).toBeGreaterThanOrEqual(1);
  });
});
