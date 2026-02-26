import { Writable } from 'node:stream';

export interface ElasticsearchTransportOptions {
  endpoint: string;
  indexPrefix: string;
  username?: string;
  password?: string;
  batchSize: number;
  flushIntervalMs: number;
}

/**
 * Formats an ISO date string into YYYY.MM.DD for Elasticsearch daily index rotation.
 */
export function formatIndexDate(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}.${m}.${d}`;
}

/**
 * Builds an NDJSON bulk payload for Elasticsearch _bulk API.
 * Each log entry becomes two lines: an action line and a document line.
 */
export function buildBulkBody(
  logs: Record<string, unknown>[],
  indexPrefix: string,
): string {
  let body = '';
  for (const log of logs) {
    const timestamp = log['time']
      ? new Date(log['time'] as number)
      : new Date();
    const indexName = `${indexPrefix}-${formatIndexDate(timestamp)}`;
    body += JSON.stringify({ index: { _index: indexName } }) + '\n';
    body += JSON.stringify(log) + '\n';
  }
  return body;
}

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

/**
 * Sends a batch of logs to Elasticsearch via the _bulk API.
 * Retries with exponential backoff on failure (up to 3 attempts).
 * Returns true on success, false after exhausting retries.
 */
export async function sendBulk(
  body: string,
  endpoint: string,
  headers: Record<string, string>,
  retryDelayFn: (ms: number) => Promise<void> = defaultDelay,
): Promise<boolean> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(`${endpoint}/_bulk`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-ndjson',
          ...headers,
        },
        body,
      });

      if (response.ok) {
        return true;
      }

      // Non-retryable client errors (4xx except 429)
      if (response.status >= 400 && response.status < 500 && response.status !== 429) {
        const text = await response.text().catch(() => '');
        process.stdout.write(
          `[log-shipping] Elasticsearch rejected batch (${response.status}): ${text}\n`,
        );
        return false;
      }

      // Server error or 429 — retry
    } catch {
      // Network error — retry
    }

    if (attempt < MAX_RETRIES - 1) {
      const delay = BASE_DELAY_MS * Math.pow(2, attempt);
      await retryDelayFn(delay);
    }
  }

  process.stdout.write(
    `[log-shipping] Failed to send batch after ${MAX_RETRIES} attempts, dropping ${body.split('\n').length / 2} logs\n`,
  );
  return false;
}

function defaultDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Creates a Pino-compatible Writable stream that batches log entries
 * and ships them to Elasticsearch via the _bulk API.
 *
 * Flushes on whichever comes first: batch size threshold or flush interval.
 * On SIGTERM/SIGINT, flushes remaining buffer before exit.
 *
 * This transport NEVER throws — all errors are caught and logged to stdout
 * so that the application's stdout logging is never disrupted.
 */
export function createElasticsearchTransport(
  opts: ElasticsearchTransportOptions,
): Writable {
  const { endpoint, indexPrefix, username, password, batchSize, flushIntervalMs } = opts;

  let buffer: Record<string, unknown>[] = [];
  let flushTimer: ReturnType<typeof setInterval> | null = null;
  let destroyed = false;

  const headers: Record<string, string> = {};
  if (username && password) {
    headers['Authorization'] = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
  }

  async function flush(): Promise<void> {
    if (buffer.length === 0 || destroyed) return;

    const batch = buffer;
    buffer = [];

    try {
      const body = buildBulkBody(batch, indexPrefix);
      await sendBulk(body, endpoint, headers);
    } catch (err) {
      // Safety net — should never reach here since sendBulk catches everything,
      // but we guard against unexpected errors to never crash the app.
      process.stdout.write(
        `[log-shipping] Unexpected error during flush: ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
  }

  const stream = new Writable({
    objectMode: true,
    write(chunk: Buffer | string, _encoding, callback) {
      try {
        const line = typeof chunk === 'string' ? chunk : chunk.toString();
        // Pino sends newline-delimited JSON; skip empty lines
        const trimmed = line.trim();
        if (!trimmed) {
          callback();
          return;
        }
        const log = JSON.parse(trimmed) as Record<string, unknown>;
        buffer.push(log);

        if (buffer.length >= batchSize) {
          flush().then(() => callback(), () => callback());
        } else {
          callback();
        }
      } catch (err) {
        // Parse error — log to stdout, don't crash
        process.stdout.write(
          `[log-shipping] Failed to parse log entry: ${err instanceof Error ? err.message : String(err)}\n`,
        );
        callback();
      }
    },
    final(callback) {
      flush().then(() => callback(), () => callback());
    },
    destroy(_err, callback) {
      destroyed = true;
      if (flushTimer) {
        clearInterval(flushTimer);
        flushTimer = null;
      }
      callback(null);
    },
  });

  // Start periodic flush interval
  flushTimer = setInterval(() => {
    flush().catch(() => {
      // Swallow — flush already logs errors to stdout
    });
  }, flushIntervalMs);

  // Prevent the timer from keeping the process alive
  if (flushTimer && typeof flushTimer === 'object' && 'unref' in flushTimer) {
    flushTimer.unref();
  }

  // Graceful shutdown handlers
  const onShutdown = () => {
    if (flushTimer) {
      clearInterval(flushTimer);
      flushTimer = null;
    }
    // Best-effort synchronous-ish flush
    flush().catch(() => {
      // Swallow — we're shutting down
    });
  };

  process.on('SIGTERM', onShutdown);
  process.on('SIGINT', onShutdown);

  // Expose for testing
  (stream as ElasticsearchTransportStream)._flush = flush;
  (stream as ElasticsearchTransportStream)._getBuffer = () => buffer;
  (stream as ElasticsearchTransportStream)._getFlushTimer = () => flushTimer;
  (stream as ElasticsearchTransportStream)._cleanup = () => {
    process.removeListener('SIGTERM', onShutdown);
    process.removeListener('SIGINT', onShutdown);
    if (flushTimer) {
      clearInterval(flushTimer);
      flushTimer = null;
    }
  };

  return stream;
}

/** Extended type for test access to internal state */
export interface ElasticsearchTransportStream extends Writable {
  _flush: () => Promise<void>;
  _getBuffer: () => Record<string, unknown>[];
  _getFlushTimer: () => ReturnType<typeof setInterval> | null;
  _cleanup: () => void;
}
