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

export class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failures = 0;
  private successes = 0;
  private lastFailure?: Date;
  private openedAt?: number;
  private consecutiveProbeFailures = 0;

  private readonly cbName: string;
  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;
  private readonly isFailure: (error: unknown) => boolean;

  constructor(options: CircuitBreakerOptions) {
    this.cbName = options.name ?? 'default';
    this.failureThreshold = options.failureThreshold;
    this.resetTimeoutMs = options.resetTimeoutMs;
    this.isFailure = options.isFailure ?? (() => true);
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      if (this.shouldTransitionToHalfOpen()) {
        this.state = 'HALF_OPEN';
        this.logTransition('Circuit breaker transitioning to HALF_OPEN');
      } else {
        throw new CircuitBreakerOpenError(this.cbName, this.resetTimeoutMs);
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
    };
  }

  reset(): void {
    this.state = 'CLOSED';
    this.failures = 0;
    this.successes = 0;
    this.consecutiveProbeFailures = 0;
    this.lastFailure = undefined;
    this.openedAt = undefined;
    log.info({ name: this.cbName }, 'Circuit breaker reset to CLOSED');
  }

  private shouldTransitionToHalfOpen(): boolean {
    if (!this.openedAt) return false;
    return Date.now() - this.openedAt >= this.resetTimeoutMs;
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
