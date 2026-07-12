/**
 * Lazily-reconnecting Redis connection for the anomaly cooldown / persistence
 * stores (#1496).
 *
 * Both stores create dedicated node-redis clients with `reconnectStrategy:
 * false`, which means a runtime disconnect (Redis restart, OOM eviction,
 * network blip) closes the client permanently — every subsequent command
 * rejects with ClientClosedError until the backend restarts. This helper
 * mirrors the HybridCache pattern in `portainer/portainer-cache.ts`
 * (`disableRedisTemporarily` / `ensureRedisClient`): failures trip an
 * exponential-backoff window, and the first operation after the window expires
 * recreates the client. State transitions are logged once (down: warn,
 * up: info); repeat failures inside an outage log at debug to avoid spam.
 */
import { createClient } from 'redis';

// ReturnType of the uninstantiated createClient signature resolves the RESP
// generic differently from an actual createClient({ ... }) call, so pin the
// generics explicitly — same pattern as portainer-cache.ts.
type RedisClient = ReturnType<typeof createClient<{}, {}, {}, 3, {}>>;

/** Minimal pino child-logger slice used for state-transition logging. */
interface StoreLogger {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
  debug: (obj: unknown, msg?: string) => void;
}

/**
 * The slice resilient stores need. Kept as an interface so tests can inject a
 * fake connection without touching the network.
 */
export interface RedisConnectionLike {
  /** Resolve an open client, or `null` while Redis is down / backing off. */
  getClient(): Promise<object | null>;
  /** Report a failed command: trips the reconnect backoff. */
  reportFailure(reason: string, err?: unknown): void;
}

const BACKOFF_BASE_MS = 2_000;
const BACKOFF_CAP_MS = 300_000; // 5 minutes — same cap as HybridCache

export class ResilientRedisConnection implements RedisConnectionLike {
  private client: RedisClient | null = null;
  private connectPromise: Promise<RedisClient | null> | null = null;
  private disabledUntil = 0;
  private failureCount = 0;

  constructor(
    private readonly url: string,
    private readonly log: StoreLogger,
    private readonly name: string,
  ) {}

  reportFailure(reason: string, err?: unknown): void {
    this.failureCount++;
    const delayMs = Math.min(
      BACKOFF_BASE_MS * 2 ** (this.failureCount - 1),
      BACKOFF_CAP_MS,
    );
    this.disabledUntil = Date.now() + delayMs;
    const payload = { err, reason, attempt: this.failureCount, backoffMs: delayMs };
    if (this.failureCount === 1) {
      // State transition healthy → down: log loudly, once.
      this.log.warn(payload, `${this.name}: Redis unavailable, degrading to in-memory fallback`);
    } else {
      this.log.debug(payload, `${this.name}: Redis still unavailable`);
    }
  }

  private reportRecovered(): void {
    if (this.failureCount > 0) {
      // State transition down → healthy.
      this.log.info(
        { previousFailures: this.failureCount },
        `${this.name}: Redis recovered, resuming Redis-backed operation`,
      );
    }
    this.failureCount = 0;
    this.disabledUntil = 0;
  }

  async getClient(): Promise<RedisClient | null> {
    if (Date.now() < this.disabledUntil) return null;
    if (this.client?.isOpen) return this.client;
    if (!this.connectPromise) {
      this.connectPromise = this.connect().finally(() => {
        this.connectPromise = null;
      });
    }
    return this.connectPromise;
  }

  private async connect(): Promise<RedisClient | null> {
    const client = createClient({
      url: this.url,
      // reconnectStrategy stays false: reconnection is handled HERE via
      // backoff + recreation so commands never queue against a dead socket.
      socket: { connectTimeout: 3_000, reconnectStrategy: false },
    });
    client.on('error', (err) => this.reportFailure('redis-client-error', err));
    client.on('end', () => this.reportFailure('redis-client-closed'));

    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        client.connect(),
        new Promise<never>((_, reject) => {
          timeoutHandle = setTimeout(
            () => reject(new Error('redis connect timeout (5s)')),
            5_000,
          );
        }),
      ]);
      this.client = client;
      this.reportRecovered();
      return client;
    } catch (err) {
      this.client = null;
      // Drop listeners first so tearing down the failed client does not emit
      // a second spurious 'end' failure, then release its socket.
      client.removeAllListeners();
      try {
        client.destroy();
      } catch {
        // Already closed — nothing to release.
      }
      this.reportFailure('redis-connect-failed', err);
      return null;
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
    }
  }
}
