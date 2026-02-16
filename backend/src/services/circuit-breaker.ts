import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('circuit-breaker');

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerOptions {
  name?: string;
  failureThreshold: number;
  resetTimeoutMs: number;
  isFailure?: (error: unknown) => boolean;
}

export interface CircuitBreakerStats {
  state: CircuitState;
  failures: number;
  successes: number;
  lastFailure?: Date;
  consecutiveProbeFailures: number;
  currentResetTimeoutMs: number;
  degraded: boolean;
}

export class CircuitBreakerOpenError extends Error {
  constructor(name: string, resetTimeoutMs: number) {
    super(
      `Circuit breaker "${name}" is OPEN \u2014 requests are being rejected. Will retry after ${resetTimeoutMs}ms.`,
    );
    this.name = 'CircuitBreakerOpenError';
  }
}

/** Number of consecutive probe failures before switching to DEBUG-level logging. */
const PROBE_FAILURE_LOG_THRESHOLD = 3;

/** Number of consecutive probe failures before the breaker is considered degraded. */
const DEGRADED_THRESHOLD = 5;

/** Maximum backoff multiplier (2^n) — caps at 300 000 ms (5 minutes). */
const MAX_RESET_TIMEOUT_MS = 300_000;

export class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failures = 0;
  private successes = 0;
  private lastFailure?: Date;
  private openedAt?: number;
  private consecutiveProbeFailures = 0;
  /** Grows exponentially after each consecutive probe failure, resets on success. */
  private currentResetTimeoutMs: number;

  private readonly cbName: string;
  private readonly failureThreshold: number;
  private readonly baseResetTimeoutMs: number;
  private readonly isFailure: (error: unknown) => boolean;

  constructor(options: CircuitBreakerOptions) {
    this.cbName = options.name ?? 'default';
    this.failureThreshold = options.failureThreshold;
    this.baseResetTimeoutMs = options.resetTimeoutMs;
    this.currentResetTimeoutMs = options.resetTimeoutMs;
    this.isFailure = options.isFailure ?? (() => true);
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      if (this.shouldTransitionToHalfOpen()) {
        this.state = 'HALF_OPEN';
        this.logTransition('Circuit breaker transitioning to HALF_OPEN');
      } else {
        throw new CircuitBreakerOpenError(this.cbName, this.currentResetTimeoutMs);
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      if (this.isFailure(error)) {
        this.onFailure();
      }
      throw error;
    }
  }

  getState(): CircuitState {
    if (this.state === 'OPEN' && this.shouldTransitionToHalfOpen()) {
      this.state = 'HALF_OPEN';
      this.logTransition('Circuit breaker transitioning to HALF_OPEN');
    }
    return this.state;
  }

  getStats(): CircuitBreakerStats {
    return {
      state: this.getState(),
      failures: this.failures,
      successes: this.successes,
      lastFailure: this.lastFailure,
      consecutiveProbeFailures: this.consecutiveProbeFailures,
      currentResetTimeoutMs: this.currentResetTimeoutMs,
      degraded: this.isDegraded(),
    };
  }

  /**
   * Returns true when the breaker has failed enough consecutive probes
   * to be considered degraded. Callers can use this to skip the endpoint
   * entirely rather than waiting for the next probe cycle.
   */
  isDegraded(): boolean {
    return this.state === 'OPEN' && this.consecutiveProbeFailures >= DEGRADED_THRESHOLD;
  }

  reset(): void {
    this.state = 'CLOSED';
    this.failures = 0;
    this.successes = 0;
    this.consecutiveProbeFailures = 0;
    this.currentResetTimeoutMs = this.baseResetTimeoutMs;
    this.lastFailure = undefined;
    this.openedAt = undefined;
    log.info({ name: this.cbName }, 'Circuit breaker reset to CLOSED');
  }

  private shouldTransitionToHalfOpen(): boolean {
    if (!this.openedAt) return false;
    return Date.now() - this.openedAt >= this.currentResetTimeoutMs;
  }

  private onSuccess(): void {
    if (this.state === 'HALF_OPEN') {
      if (this.consecutiveProbeFailures > 0) {
        log.info(
          { name: this.cbName, previousConsecutiveFailures: this.consecutiveProbeFailures },
          'Circuit breaker probe succeeded after consecutive failures \u2014 closing circuit',
        );
      } else {
        log.info({ name: this.cbName }, 'Circuit breaker probe succeeded \u2014 closing circuit');
      }
      this.state = 'CLOSED';
      this.failures = 0;
      this.consecutiveProbeFailures = 0;
      this.currentResetTimeoutMs = this.baseResetTimeoutMs;
    }
    this.successes++;
  }

  private onFailure(): void {
    this.failures++;
    this.lastFailure = new Date();
    if (this.state === 'HALF_OPEN') {
      this.consecutiveProbeFailures++;
      if (this.consecutiveProbeFailures <= PROBE_FAILURE_LOG_THRESHOLD) {
        log.warn({ name: this.cbName }, 'Circuit breaker probe failed \u2014 re-opening circuit');
      } else if (this.consecutiveProbeFailures === PROBE_FAILURE_LOG_THRESHOLD + 1) {
        log.warn(
          { name: this.cbName, consecutiveFailures: this.consecutiveProbeFailures },
          'Circuit breaker probe continues to fail \u2014 suppressing further warnings to debug level',
        );
      } else {
        log.debug(
          { name: this.cbName, consecutiveFailures: this.consecutiveProbeFailures },
          'Circuit breaker probe failed \u2014 re-opening circuit (suppressed)',
        );
      }
      this.state = 'OPEN';
      this.openedAt = Date.now();
      // Exponential backoff: double the reset timeout after each consecutive probe failure
      this.currentResetTimeoutMs = Math.min(
        this.currentResetTimeoutMs * 2,
        MAX_RESET_TIMEOUT_MS,
      );
      return;
    }
    if (this.failures >= this.failureThreshold) {
      log.warn(
        { name: this.cbName, failures: this.failures, threshold: this.failureThreshold },
        'Circuit breaker opening \u2014 failure threshold reached',
      );
      this.state = 'OPEN';
      this.openedAt = Date.now();
    }
  }

  /** Log transition message at INFO for the first few transitions, then at DEBUG to reduce noise. */
  private logTransition(message: string): void {
    if (this.consecutiveProbeFailures < PROBE_FAILURE_LOG_THRESHOLD) {
      log.info({ name: this.cbName }, message);
    } else {
      log.debug(
        { name: this.cbName, consecutiveFailures: this.consecutiveProbeFailures },
        message,
      );
    }
  }
}
