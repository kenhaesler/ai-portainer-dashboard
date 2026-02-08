import { Agent, fetch as undiciFetch } from 'undici';
import pLimit from 'p-limit';
import { getConfig } from '../config/index.js';
import { createChildLogger } from '../utils/logger.js';
import { withSpan } from './trace-context.js';
import {
  EndpointSchema, ContainerSchema, StackSchema,
  ContainerStatsSchema, NetworkSchema, ImageSchema,
  EndpointArraySchema, ContainerArraySchema, StackArraySchema,
  NetworkArraySchema, ImageArraySchema,
  type Endpoint, type Container, type Stack,
  type ContainerStats, type Network, type DockerImage,
} from '../models/portainer.js';

const log = createChildLogger('portainer-client');

// Concurrency limiter — lazily initialized from config
let limiter: ReturnType<typeof pLimit> | undefined;
function getLimiter(): ReturnType<typeof pLimit> {
  if (!limiter) {
    const config = getConfig();
    limiter = pLimit(config.PORTAINER_CONCURRENCY);
  }
  return limiter;
}

/** Exported for testing — resets the cached limiter and dispatcher */
export function _resetClientState(): void {
  limiter = undefined;
  pooledDispatcher = undefined;
}

// Connection-pooled dispatcher (used for both SSL-bypass and normal connections)
let pooledDispatcher: Agent | undefined;
function getDispatcher(): Agent | undefined {
  const config = getConfig();
  if (pooledDispatcher) return pooledDispatcher;
  const poolOptions = {
    connections: config.PORTAINER_MAX_CONNECTIONS,
    pipelining: 1,
    ...(!config.PORTAINER_VERIFY_SSL && { connect: { rejectUnauthorized: false } }),
  };
  pooledDispatcher = new Agent(poolOptions);
  return pooledDispatcher;
}

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

const SENSITIVE_LABEL_KEYS = new Set([
  'com.docker.compose.project.config_files',
]);

function looksLikeHostPath(value: string): boolean {
  return /^(\/|~\/|[A-Za-z]:[\\/])/.test(value);
}

export function sanitizeContainerLabels(labels: Record<string, string>): Record<string, string> {
  const sanitized: Record<string, string> = {};

  for (const [key, value] of Object.entries(labels)) {
    const shouldRedact =
      SENSITIVE_LABEL_KEYS.has(key) ||
      key.startsWith('desktop.docker.io/binds/') ||
      looksLikeHostPath(value);

    sanitized[key] = shouldRedact ? '[REDACTED]' : value;
  }

  return sanitized;
}

export function decodeDockerLogPayload(payload: Buffer): string {
  // Docker can return multiplexed stream frames:
  // 1 byte stream type, 3 bytes padding, 4 bytes payload length, then payload bytes.
  if (payload.length < 8) {
    return payload.toString('utf8');
  }

  const chunks: Buffer[] = [];
  let offset = 0;
  let framed = false;

  while (offset + 8 <= payload.length) {
    const streamType = payload[offset];
    const hasPadding = payload[offset + 1] === 0 && payload[offset + 2] === 0 && payload[offset + 3] === 0;
    if (!hasPadding || (streamType !== 1 && streamType !== 2 && streamType !== 0)) {
      break;
    }

    const size = payload.readUInt32BE(offset + 4);
    const start = offset + 8;
    const end = start + size;
    if (end > payload.length) {
      break;
    }

    chunks.push(payload.subarray(start, end));
    framed = true;
    offset = end;
  }

  if (framed && offset === payload.length) {
    return Buffer.concat(chunks).toString('utf8');
  }

  return payload.toString('utf8');
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
  const { method = 'GET' } = options;
  return getLimiter()(() =>
    withSpan(`${method} ${path}`, 'portainer-api', 'client', () =>
      portainerFetchInner<T>(path, options),
    ),
  );
}

async function portainerFetchInner<T>(
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
  const base = config.PORTAINER_API_URL.replace(/\/+$/, '');
  const url = `${base}${path}`;

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

      const res = await undiciFetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
        dispatcher: getDispatcher(),
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
      const cause = err instanceof Error && 'cause' in err ? (err.cause as Error)?.message : '';
      const msg = err instanceof Error ? err.message : 'Network error';
      throw new PortainerError(
        cause ? `${msg}: ${cause}` : msg,
        'network',
      );
    }
  }
  throw new PortainerError('Max retries exceeded', 'network');
}

// Endpoints
export async function getEndpoints(): Promise<Endpoint[]> {
  const raw = await portainerFetch<unknown[]>('/api/endpoints');
  return EndpointArraySchema.parse(raw);
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
  return ContainerArraySchema.parse(raw).map((container) => ({
    ...container,
    Labels: sanitizeContainerLabels(container.Labels ?? {}),
  }));
}

export async function getContainer(endpointId: number, containerId: string): Promise<Container> {
  const raw = await portainerFetch<unknown>(
    `/api/endpoints/${endpointId}/docker/containers/${containerId}/json`,
  );
  const container = ContainerSchema.parse(raw);
  return {
    ...container,
    Labels: sanitizeContainerLabels(container.Labels ?? {}),
  };
}

export interface InspectHostConfig {
  NetworkMode?: string;
  Privileged?: boolean;
  CapAdd?: string[] | null;
  CapDrop?: string[] | null;
  PidMode?: string;
}

/** Fetch only the HostConfig from a container inspect call. */
export async function getContainerHostConfig(endpointId: number, containerId: string): Promise<InspectHostConfig> {
  const raw = await portainerFetch<{ HostConfig?: InspectHostConfig }>(
    `/api/endpoints/${endpointId}/docker/containers/${containerId}/json`,
  );
  return raw.HostConfig ?? {};
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

  const res = await undiciFetch(url, { headers, dispatcher: getDispatcher() });
  if (!res.ok) throw new PortainerError(`Log fetch failed: ${res.status}`, classifyError(res.status), res.status);
  const raw = Buffer.from(await res.arrayBuffer());
  return decodeDockerLogPayload(raw);
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
  return StackArraySchema.parse(raw);
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
  return NetworkArraySchema.parse(raw);
}

// Images
export async function getImages(endpointId: number): Promise<DockerImage[]> {
  const raw = await portainerFetch<unknown[]>(
    `/api/endpoints/${endpointId}/docker/images/json`,
  );
  return ImageArraySchema.parse(raw);
}

// Exec (for packet capture and other read-only operations)
export async function createExec(
  endpointId: number,
  containerId: string,
  cmd: string[],
  options?: { user?: string; privileged?: boolean },
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
        ...(options?.user && { User: options.user }),
        ...(options?.privileged && { Privileged: options.privileged }),
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

  const res = await undiciFetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ Detach: true, Tty: false }),
    dispatcher: getDispatcher(),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new PortainerError(`Exec start failed: ${res.status} ${body}`.trim(), classifyError(res.status), res.status);
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

  const res = await undiciFetch(url, { headers, dispatcher: getDispatcher() });
  if (!res.ok) {
    throw new PortainerError(`Archive fetch failed: ${res.status}`, classifyError(res.status), res.status);
  }

  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
