import { getConfig } from '../config/index.js';
import { createChildLogger } from '../utils/logger.js';
import {
  EndpointSchema, ContainerSchema, StackSchema,
  ContainerStatsSchema, NetworkSchema, ImageSchema,
  type Endpoint, type Container, type Stack,
  type ContainerStats, type Network, type DockerImage,
} from '../models/portainer.js';

const log = createChildLogger('portainer-client');

type ErrorKind = 'network' | 'auth' | 'rate-limit' | 'server' | 'unknown';

class PortainerError extends Error {
  constructor(
    message: string,
    public readonly kind: ErrorKind,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'PortainerError';
  }
}

function classifyError(status: number): ErrorKind {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate-limit';
  if (status >= 500) return 'server';
  return 'unknown';
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function portainerFetch<T>(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    timeout?: number;
    retries?: number;
  } = {},
): Promise<T> {
  const config = getConfig();
  const { method = 'GET', body, timeout = 15000, retries = 3 } = options;
  const url = `${config.PORTAINER_API_URL}${path}`;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (config.PORTAINER_API_KEY) {
        headers['X-API-Key'] = config.PORTAINER_API_KEY;
      }

      const res = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!res.ok) {
        const kind = classifyError(res.status);
        if (kind === 'auth') {
          throw new PortainerError(`Auth failed: ${res.status}`, 'auth', res.status);
        }
        if (kind === 'rate-limit' && attempt < retries) {
          const delay = Math.pow(2, attempt) * 1000;
          log.warn({ attempt, delay, status: res.status }, 'Rate limited, retrying');
          await sleep(delay);
          continue;
        }
        throw new PortainerError(`HTTP ${res.status}: ${res.statusText}`, kind, res.status);
      }

      return await res.json() as T;
    } catch (err) {
      if (err instanceof PortainerError) throw err;
      if (attempt < retries) {
        const delay = Math.pow(2, attempt) * 1000;
        log.warn({ attempt, delay, err }, 'Request failed, retrying');
        await sleep(delay);
        continue;
      }
      throw new PortainerError(
        err instanceof Error ? err.message : 'Network error',
        'network',
      );
    }
  }
  throw new PortainerError('Max retries exceeded', 'network');
}

// Endpoints
export async function getEndpoints(): Promise<Endpoint[]> {
  const raw = await portainerFetch<unknown[]>('/api/endpoints');
  return raw.map((e) => EndpointSchema.parse(e));
}

export async function getEndpoint(id: number): Promise<Endpoint> {
  const raw = await portainerFetch<unknown>(`/api/endpoints/${id}`);
  return EndpointSchema.parse(raw);
}

// Containers
export async function getContainers(endpointId: number, all = true): Promise<Container[]> {
  const raw = await portainerFetch<unknown[]>(
    `/api/endpoints/${endpointId}/docker/containers/json?all=${all}`,
  );
  return raw.map((c) => ContainerSchema.parse(c));
}

export async function getContainer(endpointId: number, containerId: string): Promise<Container> {
  const raw = await portainerFetch<unknown>(
    `/api/endpoints/${endpointId}/docker/containers/${containerId}/json`,
  );
  return ContainerSchema.parse(raw);
}

export async function startContainer(endpointId: number, containerId: string): Promise<void> {
  await portainerFetch(`/api/endpoints/${endpointId}/docker/containers/${containerId}/start`, {
    method: 'POST',
  });
}

export async function stopContainer(endpointId: number, containerId: string): Promise<void> {
  await portainerFetch(`/api/endpoints/${endpointId}/docker/containers/${containerId}/stop`, {
    method: 'POST',
  });
}

export async function restartContainer(endpointId: number, containerId: string): Promise<void> {
  await portainerFetch(`/api/endpoints/${endpointId}/docker/containers/${containerId}/restart`, {
    method: 'POST',
  });
}

export async function getContainerLogs(
  endpointId: number,
  containerId: string,
  options: { tail?: number; since?: number; until?: number; timestamps?: boolean } = {},
): Promise<string> {
  const params = new URLSearchParams({
    stdout: 'true',
    stderr: 'true',
    tail: String(options.tail || 100),
    timestamps: String(options.timestamps ?? true),
  });
  if (options.since) params.set('since', String(options.since));
  if (options.until) params.set('until', String(options.until));

  const config = getConfig();
  const url = `${config.PORTAINER_API_URL}/api/endpoints/${endpointId}/docker/containers/${containerId}/logs?${params}`;

  const headers: Record<string, string> = {};
  if (config.PORTAINER_API_KEY) {
    headers['X-API-Key'] = config.PORTAINER_API_KEY;
  }

  const res = await fetch(url, { headers });
  if (!res.ok) throw new PortainerError(`Log fetch failed: ${res.status}`, classifyError(res.status), res.status);
  return res.text();
}

export async function getContainerStats(endpointId: number, containerId: string): Promise<ContainerStats> {
  const raw = await portainerFetch<unknown>(
    `/api/endpoints/${endpointId}/docker/containers/${containerId}/stats?stream=false`,
    { timeout: 10000 },
  );
  return ContainerStatsSchema.parse(raw);
}

// Stacks
export async function getStacks(): Promise<Stack[]> {
  const raw = await portainerFetch<unknown[]>('/api/stacks');
  return raw.map((s) => StackSchema.parse(s));
}

export async function getStack(id: number): Promise<Stack> {
  const raw = await portainerFetch<unknown>(`/api/stacks/${id}`);
  return StackSchema.parse(raw);
}

// Networks
export async function getNetworks(endpointId: number): Promise<Network[]> {
  const raw = await portainerFetch<unknown[]>(
    `/api/endpoints/${endpointId}/docker/networks`,
  );
  return raw.map((n) => NetworkSchema.parse(n));
}

// Images
export async function getImages(endpointId: number): Promise<DockerImage[]> {
  const raw = await portainerFetch<unknown[]>(
    `/api/endpoints/${endpointId}/docker/images/json`,
  );
  return raw.map((i) => ImageSchema.parse(i));
}

// Exec (for packet capture and other read-only operations)
export async function createExec(
  endpointId: number,
  containerId: string,
  cmd: string[],
): Promise<{ Id: string }> {
  return portainerFetch<{ Id: string }>(
    `/api/endpoints/${endpointId}/docker/containers/${containerId}/exec`,
    {
      method: 'POST',
      body: {
        AttachStdin: false,
        AttachStdout: false,
        AttachStderr: false,
        Detach: true,
        Tty: false,
        Cmd: cmd,
      },
    },
  );
}

export async function startExec(endpointId: number, execId: string): Promise<void> {
  const config = getConfig();
  const url = `${config.PORTAINER_API_URL}/api/endpoints/${endpointId}/docker/exec/${execId}/start`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (config.PORTAINER_API_KEY) {
    headers['X-API-Key'] = config.PORTAINER_API_KEY;
  }

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ Detach: true, Tty: false }),
  });

  if (!res.ok) {
    throw new PortainerError(`Exec start failed: ${res.status}`, classifyError(res.status), res.status);
  }
}

export async function inspectExec(
  endpointId: number,
  execId: string,
): Promise<{ Running: boolean; ExitCode: number; Pid: number }> {
  return portainerFetch<{ Running: boolean; ExitCode: number; Pid: number }>(
    `/api/endpoints/${endpointId}/docker/exec/${execId}/json`,
  );
}

export async function getArchive(
  endpointId: number,
  containerId: string,
  containerPath: string,
): Promise<Buffer> {
  const config = getConfig();
  const url = `${config.PORTAINER_API_URL}/api/endpoints/${endpointId}/docker/containers/${containerId}/archive?path=${encodeURIComponent(containerPath)}`;

  const headers: Record<string, string> = {};
  if (config.PORTAINER_API_KEY) {
    headers['X-API-Key'] = config.PORTAINER_API_KEY;
  }

  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new PortainerError(`Archive fetch failed: ${res.status}`, classifyError(res.status), res.status);
  }

  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
