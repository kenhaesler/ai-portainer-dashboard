import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Response, fetch as undiciFetch } from 'undici';
import { resetConfig, setConfigForTest } from '../config/index.js';
import { EndpointSchema, ContainerSchema, ImageSchema, containerFromInspect } from '../models/portainer.js';
import { normalizeEndpoint, normalizeContainer, normalizeStack } from './portainer-normalizers.js';
import { StackStatusSchema } from '@dashboard/contracts';
import { _resetClientState, getEndpoints, getEndpoint, getContainers, getImages, getCircuitBreakerStats } from './portainer-client.js';

vi.mock('undici', async (importOriginal) => ({
  ...await importOriginal<typeof import('undici')>(),
  fetch: vi.fn(),
}));

const fetchMock = vi.mocked(undiciFetch);
const endpoint = { Id: 1, Name: 'docker', Type: 1, URL: 'unix:///var/run/docker.sock' };
const container = { Id: 'abc123', Names: ['/web'], Image: 'nginx:latest', Created: 1700000000, State: 'running', Status: 'Up' };

beforeEach(() => {
  resetConfig();
  setConfigForTest({ PORTAINER_API_URL: 'https://portainer.example.test', CACHE_ENABLED: false });
  _resetClientState();
  fetchMock.mockReset();
});
afterEach(() => { resetConfig(); _resetClientState(); });

describe('Portainer 2.45 endpoint compatibility', () => {
  it.each([[1, 'active'], [2, 'inactive'], [3, 'deploying'], [4, 'error'], [99, 'unknown']] as const)('preserves stack lifecycle status %s as %s', (Status, expected) => {
    const stack = normalizeStack({ Id: 1, Name: 'app', Type: 2, EndpointId: 1, Status, Env: [] });
    expect(stack.status).toBe(expected);
    expect(StackStatusSchema.parse(stack.status)).toBe(expected);
  });
  it('accepts omitted zero-valued Status without losing the whole fleet or claiming it is up', async () => {
    fetchMock.mockResolvedValue(Response.json([endpoint, { ...endpoint, Id: 2, Status: 1 }]));
    const endpoints = await getEndpoints();
    expect(endpoints.map(normalizeEndpoint).map((ep) => ep.status)).toEqual(['down', 'up']);
  });

  it('excludes unused snapshots using the distinct list and inspect query parameters', async () => {
    fetchMock.mockResolvedValueOnce(Response.json([{ ...endpoint, Status: 1 }]))
      .mockResolvedValueOnce(Response.json({ ...endpoint, Status: 1 }));
    await getEndpoints();
    await getEndpoint(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://portainer.example.test/api/endpoints?excludeSnapshots=true');
    expect(String(fetchMock.mock.calls[1][0])).toBe('https://portainer.example.test/api/endpoints/1?excludeSnapshot=true');
  });

  it('accepts legacy null collections and real DockerSnapshotRaw arrays', () => {
    expect(EndpointSchema.parse({ ...endpoint, Status: 1, Snapshots: null, TagIds: null })).toMatchObject({ Snapshots: [], TagIds: [] });
    expect(EndpointSchema.safeParse({ ...endpoint, Status: 1, Snapshots: [{ DockerSnapshotRaw: { Containers: [container], Images: [{ Id: 'sha256:abc' }] } }] }).success).toBe(true);
  });

  it('still rejects invalid identity and malformed status rather than hiding schema errors', () => {
    expect(EndpointSchema.safeParse({ ...endpoint, Id: '1' }).success).toBe(false);
    expect(EndpointSchema.safeParse({ ...endpoint, Status: 'up' }).success).toBe(false);
  });
});

describe('Docker proxy nullable collections', () => {
  it.each([401, 403])('preserves HTTP %s without retrying alternate proxy routes or tripping the fleet breaker', async (status) => {
    setConfigForTest({ PORTAINER_CB_FAILURE_THRESHOLD: 1 });
    fetchMock.mockResolvedValueOnce(Response.json({ message: 'Access denied' }, { status }));
    await expect(getContainers(1)).rejects.toMatchObject({ kind: 'auth', status });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://portainer.example.test/api/endpoints/1/docker/containers/json?all=true');
    expect(getCircuitBreakerStats()).toMatchObject({ state: 'CLOSED', failures: 0 });

    // A permission denial on one environment must not hide a permitted one.
    fetchMock.mockResolvedValueOnce(Response.json([container]));
    await expect(getContainers(2)).resolves.toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not drop a container list when an unlabelled container has nil labels and mounts', async () => {
    fetchMock.mockResolvedValueOnce(Response.json([{ ...container, Labels: null, Mounts: null }]));
    const containers = await getContainers(1);
    expect(normalizeContainer(containers[0], 1, 'docker')).toMatchObject({ name: 'web', labels: {} });
    expect(containers[0].Mounts).toEqual([]);
  });

  it('bridges inspect HostConfig.CapAdd=null back into the list contract', () => {
    const parsed = containerFromInspect({ Id: 'abc123', Name: '/web', Config: { Image: 'nginx', Labels: null }, HostConfig: { CapAdd: null } });
    expect(parsed.HostConfig?.CapAdd).toEqual([]);
    expect(ContainerSchema.safeParse(parsed).success).toBe(true);
  });

  it('keeps dangling images with nil RepoTags', async () => {
    fetchMock.mockResolvedValueOnce(Response.json([{ Id: 'sha256:abc', RepoTags: null }]));
    expect(await getImages(1)).toEqual([{ Id: 'sha256:abc', RepoTags: [] }]);
    expect(ImageSchema.safeParse({ Id: 'sha256:abc', RepoTags: 3 }).success).toBe(false);
  });
});
