import { Agent, fetch as undiciFetch } from 'undici';
import { readFileSync } from 'fs';
import pLimit from 'p-limit';
import { getConfig } from '../config/index.js';
import { createChildLogger } from '../utils/logger.js';
import { withSpan } from './trace-context.js';
import { CircuitBreaker } from './circuit-breaker.js';
import {
  EndpointSchema, ContainerSchema, StackSchema,
  ContainerStatsSchema, NetworkSchema, ImageSchema,
  EndpointArraySchema, ContainerArraySchema, StackArraySchema,
  NetworkArraySchema, ImageArraySchema,
  EdgeJobSchema, EdgeJobArraySchema, EdgeJobTaskArraySchema,
  type Endpoint, type Container, type Stack,
  type ContainerStats, type Network, type DockerImage, type EdgeJob, type EdgeJobTask,
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

/** Exported for testing — resets the cached limiter, dispatcher, and circuit breakers */
export function _resetClientState(): void {
  limiter = undefined;
  pooledDispatcher = undefined;
  breakers.clear();
}

/** Read custom CA certificate from NODE_EXTRA_CA_CERTS if set */
function getCustomCaCert(): Buffer | undefined {
  const certPath = process.env.NODE_EXTRA_CA_CERTS;
  if (!certPath) return undefined;
  try {
    return readFileSync(certPath);
  } catch (err) {
    log.warn({ err, certPath }, 'Failed to read custom CA certificate from NODE_EXTRA_CA_CERTS');
    return undefined;
  }
}

// Connection-pooled dispatcher (used for both SSL-bypass and normal connections)
let pooledDispatcher: Agent | undefined;
function getDispatcher(): Agent | undefined {
  const config = getConfig();
  if (pooledDispatcher) return pooledDispatcher;
  const ca = getCustomCaCert();
  const connectOptions: Record<string, unknown> = {};
  if (!config.PORTAINER_VERIFY_SSL) {
    connectOptions.rejectUnauthorized = false;
  } else if (ca) {
    connectOptions.ca = ca;
  }
  const poolOptions = {
    connections: config.PORTAINER_MAX_CONNECTIONS,
    pipelining: 1,
    ...(Object.keys(connectOptions).length > 0 && { connect: connectOptions }),
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

/**
 * Only 5xx and network errors should trip the circuit breaker.
 * 4xx errors (auth, not-found, rate-limit) are client-side issues
 * and should NOT count as infrastructure failures.
 */
function isPortainerFailure(error: unknown): boolean {
  if (error instanceof PortainerError) {
    return error.kind === 'server' || error.kind === 'network';
  }
  // Non-PortainerError exceptions are network-level failures (ECONNREFUSED, etc.)
  return true;
}

// Per-endpoint circuit breakers — prevents one failing endpoint from cascading to all
interface BreakerEntry {
  breaker: CircuitBreaker;
  lastUsed: number;
}
const breakers = new Map<string, BreakerEntry>();
const ENDPOINT_PATH_RE = /\/api\/endpoints\/(\d+)\//;
const BREAKER_PRUNE_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
const BREAKER_MAX_IDLE_MS = 60 * 60 * 1000; // 1 hour

function extractBreakerKey(path: string): string {
  const match = path.match(ENDPOINT_PATH_RE);
  return match ? `endpoint-${match[1]}` : 'global';
}

function getBreaker(path: string): CircuitBreaker {
  const key = extractBreakerKey(path);
  const entry = breakers.get(key);
  if (entry) {
    entry.lastUsed = Date.now();
    return entry.breaker;
  }
  const config = getConfig();
  const breaker = new CircuitBreaker({
    name: `portainer-api:${key}`,
    failureThreshold: config.PORTAINER_CB_FAILURE_THRESHOLD,
    resetTimeoutMs: config.PORTAINER_CB_RESET_TIMEOUT_MS,
    isFailure: isPortainerFailure,
  });
  breakers.set(key, { breaker, lastUsed: Date.now() });
  return breaker;
}

/** Check whether the circuit breaker for a given endpoint is degraded (persistently failing). */
export function isEndpointDegraded(endpointId: number): boolean {
  const key = `endpoint-${endpointId}`;
  const entry = breakers.get(key);
  if (!entry) return false;
  return entry.breaker.isDegraded();
}

/** Remove breakers for endpoints not seen in the last hour */
export function pruneStaleBreakers(): number {
  const cutoff = Date.now() - BREAKER_MAX_IDLE_MS;
  let pruned = 0;
  for (const [key, entry] of breakers) {
    if (entry.lastUsed < cutoff) {
      breakers.delete(key);
      pruned++;
    }
  }
  if (pruned > 0) {
    log.info({ pruned, remaining: breakers.size }, 'Pruned stale circuit breakers');
  }
  return pruned;
}

// Periodic breaker cleanup timer
let breakerPruneTimer: ReturnType<typeof setInterval> | undefined;

export function startBreakerPruning(): void {
  if (breakerPruneTimer) return;
  breakerPruneTimer = setInterval(pruneStaleBreakers, BREAKER_PRUNE_INTERVAL_MS);
  breakerPruneTimer.unref(); // Don't block process exit
}

export function stopBreakerPruning(): void {
  if (breakerPruneTimer) {
    clearInterval(breakerPruneTimer);
    breakerPruneTimer = undefined;
  }
}

/** Returns circuit breaker stats aggregated across all endpoints. */
export function getCircuitBreakerStats() {
  const allStats: Record<string, ReturnType<CircuitBreaker['getStats']>> = {};
  for (const [key, entry] of breakers) {
    allStats[key] = entry.breaker.getStats();
  }
  // Return the worst state as the top-level summary
  const states = Object.values(allStats);
  const hasOpen = states.some((s) => s.state === 'OPEN');
  const hasHalfOpen = states.some((s) => s.state === 'HALF_OPEN');
  return {
    state: hasOpen ? 'OPEN' as const : hasHalfOpen ? 'HALF_OPEN' as const : 'CLOSED' as const,
    failures: states.reduce((sum, s) => sum + s.failures, 0),
    successes: states.reduce((sum, s) => sum + s.successes, 0),
    lastFailure: states.reduce<Date | undefined>(
      (latest, s) => (!s.lastFailure ? latest : !latest ? s.lastFailure : s.lastFailure > latest ? s.lastFailure : latest),
      undefined,
    ),
    byEndpoint: allStats,
  };
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

/** Build a full Portainer API URL from a path, consistently stripping trailing slashes. */
export function buildApiUrl(path: string): string {
  const config = getConfig();
  const base = config.PORTAINER_API_URL.replace(/\/+$/, '');
  return `${base}${path}`;
}

/** Build standard headers for Portainer API requests. */
export function buildApiHeaders(includeContentType = true): Record<string, string> {
  const config = getConfig();
  const headers: Record<string, string> = {};
  if (includeContentType) {
    headers['Content-Type'] = 'application/json';
  }
  if (config.PORTAINER_API_KEY) {
    headers['X-API-Key'] = config.PORTAINER_API_KEY;
  }
  return headers;
}

/** Read error response body from a Portainer API response for diagnostics. */
async function readErrorBody(res: { text: () => Promise<string> }): Promise<string> {
  try {
    const body = await res.text();
    // Try to extract the message from JSON error responses
    try {
      const parsed = JSON.parse(body);
      return parsed.message || parsed.details || body;
    } catch {
      return body;
    }
  } catch {
    return '';
  }
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
      getBreaker(path).execute(() => portainerFetchInner<T>(path, options)),
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
  const { method = 'GET', body, timeout = 15000, retries = 3 } = options;
  const url = buildApiUrl(path);

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);

      const headers = buildApiHeaders();

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

export async function pullImage(endpointId: number, image: string, tag = 'latest'): Promise<void> {
  const path = `/api/endpoints/${endpointId}/docker/images/create?fromImage=${encodeURIComponent(image)}&tag=${encodeURIComponent(tag)}`;
  const url = buildApiUrl(path);
  const headers = buildApiHeaders(false);

  const res = await undiciFetch(url, {
    method: 'POST',
    headers,
    dispatcher: getDispatcher(),
  });

  if (!res.ok) {
    const errorBody = await readErrorBody(res);
    throw new PortainerError(
      errorBody || `Image pull failed: ${res.status}`,
      classifyError(res.status),
      res.status,
    );
  }
}

export interface CreateContainerPayload {
  Image: string;
  Env?: string[];
  Labels?: Record<string, string>;
  HostConfig?: {
    Privileged?: boolean;
    PidMode?: string;
    Init?: boolean;
    Binds?: string[];
    RestartPolicy?: { Name: string };
  };
}

export async function createContainer(
  endpointId: number,
  payload: CreateContainerPayload,
  name?: string,
): Promise<{ Id: string; Warnings?: string[] }> {
  const nameQuery = name ? `?name=${encodeURIComponent(name)}` : '';
  return portainerFetch<{ Id: string; Warnings?: string[] }>(
    `/api/endpoints/${endpointId}/docker/containers/create${nameQuery}`,
    {
      method: 'POST',
      body: payload,
    },
  );
}

export async function removeContainer(endpointId: number, containerId: string, force = false): Promise<void> {
  const query = force ? '?force=true' : '';
  await portainerFetch(`/api/endpoints/${endpointId}/docker/containers/${containerId}${query}`, {
    method: 'DELETE',
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

  const path = `/api/endpoints/${endpointId}/docker/containers/${containerId}/logs?${params}`;
  const url = buildApiUrl(path);
  const headers = buildApiHeaders();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await undiciFetch(url, {
      headers,
      dispatcher: getDispatcher(),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      const errorBody = await readErrorBody(res);
      log.warn(
        { status: res.status, endpointId, containerId, errorBody },
        'Container logs fetch failed from Portainer API',
      );

      if (res.status === 404 || res.status === 502 || res.status === 503) {
        throw new PortainerError(
          errorBody || 'Container logs unavailable — Docker daemon on this endpoint may be unreachable',
          'server',
          res.status,
        );
      }
      throw new PortainerError(
        errorBody || `Log fetch failed: ${res.status}`,
        classifyError(res.status),
        res.status,
      );
    }
    const raw = Buffer.from(await res.arrayBuffer());
    return decodeDockerLogPayload(raw);
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof PortainerError) throw err;
    const msg = err instanceof Error ? err.message : 'Network error';
    throw new PortainerError(msg, 'network');
  }
}

/**
 * Open a streaming (follow=true) connection to container logs via the Portainer Docker proxy.
 * Returns the raw response body as a ReadableStream and an abort() function.
 *
 * Does NOT use portainerFetch, circuit breaker, or concurrency limiter because the
 * long-lived connection would hold slots indefinitely.
 */
export async function streamContainerLogs(
  endpointId: number,
  containerId: string,
  options: { since?: number; timestamps?: boolean } = {},
): Promise<{ body: ReadableStream<Uint8Array>; abort: () => void }> {
  const params = new URLSearchParams({
    stdout: 'true',
    stderr: 'true',
    follow: 'true',
    tail: '50',
    timestamps: String(options.timestamps ?? true),
  });
  if (options.since) params.set('since', String(options.since));

  const path = `/api/endpoints/${endpointId}/docker/containers/${containerId}/logs?${params}`;
  const url = buildApiUrl(path);
  const headers = buildApiHeaders();

  const controller = new AbortController();
  const res = await undiciFetch(url, {
    headers,
    dispatcher: getDispatcher(),
    signal: controller.signal,
  });

  if (!res.ok) {
    controller.abort();
    const errorBody = await readErrorBody(res);
    log.warn(
      { status: res.status, endpointId, containerId, errorBody },
      'Container log stream failed from Portainer API',
    );

    if (res.status === 404 || res.status === 502 || res.status === 503) {
      throw new PortainerError(
        errorBody || 'Container logs unavailable — Docker daemon on this endpoint may be unreachable',
        'server',
        res.status,
      );
    }
    throw new PortainerError(
      errorBody || `Log stream failed: ${res.status}`,
      classifyError(res.status),
      res.status,
    );
  }

  if (!res.body) {
    controller.abort();
    throw new PortainerError('No response body from log stream', 'server', 502);
  }

  return {
    body: res.body as unknown as ReadableStream<Uint8Array>,
    abort: () => controller.abort(),
  };
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

export async function getStacksByEndpoint(endpointId: number): Promise<Stack[]> {
  const filter = JSON.stringify({ EndpointID: endpointId });
  const raw = await portainerFetch<unknown[]>(`/api/stacks?filters=${encodeURIComponent(filter)}`);
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
  const url = buildApiUrl(`/api/endpoints/${endpointId}/docker/exec/${execId}/start`);
  const headers = buildApiHeaders();

  const res = await undiciFetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ Detach: true, Tty: false }),
    dispatcher: getDispatcher(),
  });

  if (!res.ok) {
    const errorBody = await readErrorBody(res);
    if (res.status === 404 || res.status === 502) {
      throw new PortainerError(
        errorBody || 'Exec failed — Docker daemon on this endpoint may be unreachable',
        'server',
        res.status,
      );
    }
    throw new PortainerError(
      errorBody || `Exec start failed: ${res.status}`,
      classifyError(res.status),
      res.status,
    );
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
  const url = buildApiUrl(`/api/endpoints/${endpointId}/docker/containers/${containerId}/archive?path=${encodeURIComponent(containerPath)}`);
  const headers = buildApiHeaders();

  const res = await undiciFetch(url, { headers, dispatcher: getDispatcher() });
  if (!res.ok) {
    const errorBody = await readErrorBody(res);
    throw new PortainerError(errorBody || `Archive fetch failed: ${res.status}`, classifyError(res.status), res.status);
  }

  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

// Edge Jobs
export interface CreateEdgeJobPayload {
  name: string;
  cronExpression: string;
  recurring: boolean;
  endpoints: number[];
  fileContent: string;
}

export async function getEdgeJobs(): Promise<EdgeJob[]> {
  const raw = await portainerFetch<unknown[]>('/api/edge_jobs');
  return EdgeJobArraySchema.parse(raw);
}

export async function getEdgeJob(id: number): Promise<EdgeJob> {
  const raw = await portainerFetch<unknown>(`/api/edge_jobs/${id}`);
  return EdgeJobSchema.parse(raw);
}

export async function createEdgeJob(data: CreateEdgeJobPayload): Promise<EdgeJob> {
  const raw = await portainerFetch<unknown>('/api/edge_jobs?method=string', {
    method: 'POST',
    body: {
      Name: data.name,
      CronExpression: data.cronExpression,
      Recurring: data.recurring,
      Endpoints: data.endpoints,
      FileContent: data.fileContent,
    },
  });
  return EdgeJobSchema.parse(raw);
}

export async function deleteEdgeJob(id: number): Promise<void> {
  await portainerFetch(`/api/edge_jobs/${id}`, { method: 'DELETE' });
}

export async function getEdgeJobTasks(jobId: number): Promise<EdgeJobTask[]> {
  const raw = await portainerFetch<unknown[]>(`/api/edge_jobs/${jobId}/tasks`);
  return EdgeJobTaskArraySchema.parse(raw);
}

export async function collectEdgeJobTaskLogs(jobId: number, taskId: string): Promise<void> {
  await portainerFetch(`/api/edge_jobs/${jobId}/tasks/${taskId}/logs`, { method: 'POST' });
}

export async function getEdgeJobTaskLogs(jobId: number, taskId: string): Promise<string> {
  const url = buildApiUrl(`/api/edge_jobs/${jobId}/tasks/${taskId}/logs`);
  const headers = buildApiHeaders();

  const res = await undiciFetch(url, { headers, dispatcher: getDispatcher() });
  if (!res.ok) {
    const errorBody = await readErrorBody(res);
    throw new PortainerError(errorBody || `Edge job task logs fetch failed: ${res.status}`, classifyError(res.status), res.status);
  }
  return await res.text();
}
