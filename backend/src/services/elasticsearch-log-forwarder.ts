import { Agent } from 'undici';
import { getContainers, getContainerLogs, getEndpoints } from './portainer-client.js';
import { getElasticsearchConfig, type ElasticsearchConfig } from './elasticsearch-config.js';
import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('es-log-forwarder');

const FORWARD_INTERVAL_MS = 5000;
const MAX_LOG_LINES_PER_CONTAINER = 200;
const MAX_DOCS_PER_BATCH = 200;
const START_LOOKBACK_SECONDS = 60;
const MAX_RETRY_ATTEMPTS = 3;

const TS_PREFIX_RE = /^(\d{4}-\d{2}-\d{2}T[^\s]+)\s(.*)$/;

const insecureElasticDispatcher = new Agent({
  connect: { rejectUnauthorized: false },
});

const checkpoints = new Map<string, number>();

let forwarderTimer: NodeJS.Timeout | null = null;
let cycleInProgress = false;

interface ContainerLogDoc {
  '@timestamp': string;
  message: string;
  level: 'error' | 'warn' | 'info' | 'debug' | 'unknown';
  log_origin: 'container';
  containerId: string;
  containerName: string;
  endpointId: number;
  endpointName: string;
  containerState: string;
  containerStatus: string;
  containerImage: string;
}

function detectLevel(input: string): ContainerLogDoc['level'] {
  const line = input.toLowerCase();
  if (/\berror\b|\bfatal\b|\bpanic\b|\bexception\b/.test(line)) return 'error';
  if (/\bwarn\b|\bwarning\b/.test(line)) return 'warn';
  if (/\bdebug\b|\btrace\b/.test(line)) return 'debug';
  if (/\binfo\b/.test(line)) return 'info';
  return 'unknown';
}

function parseLine(line: string): { timestamp: string; message: string } {
  const match = line.match(TS_PREFIX_RE);
  if (!match) {
    return {
      timestamp: new Date().toISOString(),
      message: line,
    };
  }

  const parsed = new Date(match[1]);
  const ts = Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
  return {
    timestamp: ts,
    message: match[2] || line,
  };
}

function buildContainerDoc(
  line: string,
  endpointId: number,
  endpointName: string,
  containerId: string,
  containerName: string,
  containerState: string,
  containerStatus: string,
  containerImage: string,
): ContainerLogDoc {
  const parsed = parseLine(line);
  return {
    '@timestamp': parsed.timestamp,
    message: parsed.message,
    level: detectLevel(parsed.message),
    log_origin: 'container',
    containerId,
    containerName,
    endpointId,
    endpointName,
    containerState,
    containerStatus,
    containerImage,
  };
}

async function indexBatch(esConfig: ElasticsearchConfig, docs: ContainerLogDoc[]): Promise<void> {
  if (docs.length === 0) return;

  const bulkBody = docs
    .flatMap((doc) => [
      JSON.stringify({ index: { _index: esConfig.indexPattern } }),
      JSON.stringify(doc),
    ])
    .join('\n') + '\n';

  const headers: Record<string, string> = {
    'Content-Type': 'application/x-ndjson',
  };
  if (esConfig.apiKey) headers.Authorization = `ApiKey ${esConfig.apiKey}`;

  const dispatcher = esConfig.verifySsl ? undefined : insecureElasticDispatcher;

  let attempt = 0;
  while (attempt < MAX_RETRY_ATTEMPTS) {
    attempt += 1;
    try {
      const response = await fetch(`${esConfig.endpoint}/_bulk`, {
        method: 'POST',
        headers,
        body: bulkBody,
        dispatcher,
      } as RequestInit);

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Elasticsearch bulk index failed (${response.status}): ${body}`);
      }

      const payload = await response.json() as { errors?: boolean };
      if (payload.errors) {
        log.warn('Elasticsearch bulk request completed with partial failures');
      }
      return;
    } catch (err) {
      if (attempt >= MAX_RETRY_ATTEMPTS) throw err;
      await new Promise((resolve) => setTimeout(resolve, attempt * 250));
    }
  }
}

function getCheckpointKey(endpointId: number, containerId: string): string {
  return `${endpointId}:${containerId}`;
}

function getContainerName(rawNames: string[] | undefined, fallbackId: string): string {
  return rawNames?.[0]?.replace(/^\//, '') || fallbackId.slice(0, 12);
}

function getInitialSince(): number {
  return Math.floor(Date.now() / 1000) - START_LOOKBACK_SECONDS;
}

export function resetElasticsearchLogForwarderState(): void {
  checkpoints.clear();
  cycleInProgress = false;
}

export async function runElasticsearchLogForwardingCycle(): Promise<void> {
  if (cycleInProgress) {
    return;
  }

  cycleInProgress = true;

  try {
    const initialConfig = getElasticsearchConfig();
    if (!initialConfig?.enabled || !initialConfig.endpoint) {
      return;
    }

    const endpoints = await getEndpoints();

    for (const endpoint of endpoints) {
      const endpointConfig = getElasticsearchConfig();
      if (!endpointConfig?.enabled || !endpointConfig.endpoint) {
        log.info('Elasticsearch log forwarding disabled during cycle; stopping early');
        return;
      }

      const containers = await getContainers(endpoint.Id, true);
      const runningContainers = containers.filter((container) => container.State === 'running');

      for (const container of runningContainers) {
        const liveConfig = getElasticsearchConfig();
        if (!liveConfig?.enabled || !liveConfig.endpoint) {
          log.info('Elasticsearch log forwarding disabled during cycle; stopping early');
          return;
        }

        const containerName = getContainerName(container.Names, container.Id);
        const checkpointKey = getCheckpointKey(endpoint.Id, container.Id);
        const since = checkpoints.get(checkpointKey) ?? getInitialSince();

        try {
          const logsRaw = await getContainerLogs(endpoint.Id, container.Id, {
            since,
            tail: MAX_LOG_LINES_PER_CONTAINER,
            timestamps: true,
          });

          const lines = logsRaw
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line.length > 0)
            .slice(-MAX_DOCS_PER_BATCH);

          if (lines.length === 0) {
            continue;
          }

          const docs = lines.map((line) =>
            buildContainerDoc(
              line,
              endpoint.Id,
              endpoint.Name,
              container.Id,
              containerName,
              container.State,
              container.Status,
              container.Image,
            )
          );

          await indexBatch(liveConfig, docs);

          const newestTimestampSeconds = Math.max(
            ...docs.map((doc) => Math.floor(new Date(doc['@timestamp']).getTime() / 1000))
          );
          if (Number.isFinite(newestTimestampSeconds)) {
            checkpoints.set(checkpointKey, newestTimestampSeconds);
          }
        } catch (err) {
          log.warn(
            { endpointId: endpoint.Id, containerId: container.Id, err },
            'Failed to forward container logs to Elasticsearch',
          );
        }
      }
    }
  } finally {
    cycleInProgress = false;
  }
}

export function startElasticsearchLogForwarder(): void {
  if (forwarderTimer) {
    return;
  }

  forwarderTimer = setInterval(() => {
    void runElasticsearchLogForwardingCycle();
  }, FORWARD_INTERVAL_MS);

  void runElasticsearchLogForwardingCycle();

  log.info({ intervalMs: FORWARD_INTERVAL_MS }, 'Elasticsearch log forwarder started');
}

export function stopElasticsearchLogForwarder(): void {
  if (!forwarderTimer) {
    return;
  }

  clearInterval(forwarderTimer);
  forwarderTimer = null;

  log.info('Elasticsearch log forwarder stopped');
}
