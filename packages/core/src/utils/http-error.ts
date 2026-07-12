/**
 * Typed HTTP-error contract (#1511).
 *
 * Before this existed, packages attached a status to plain Errors via ad-hoc
 * casts — `(err as any).statusCode = 422` in one service, `(err as any).status
 * = 504` in another — and every consumer had to remember to probe both
 * spellings (or silently misreport the status when it missed one). Producers
 * should throw `HttpError` (canonical `statusCode` field, matching Fastify);
 * consumers should read the status via `getErrorStatusCode()`, which also
 * honours the legacy `status` spelling still carried by `PortainerError` and
 * fetch-style upstream errors.
 */
export class HttpError extends Error {
  readonly statusCode: number;
  readonly code?: string;

  constructor(statusCode: number, message: string, options?: { code?: string; cause?: unknown }) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'HttpError';
    this.statusCode = statusCode;
    this.code = options?.code;
  }
}

function isHttpErrorStatus(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 400 && value <= 599;
}

/**
 * Extract an HTTP error status from an unknown error, preferring the
 * canonical `statusCode` (Fastify / HttpError) and falling back to `status`
 * (PortainerError, fetch-style errors). Returns undefined when neither
 * property carries a valid 4xx/5xx integer.
 */
export function getErrorStatusCode(err: unknown): number | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const candidate = err as { statusCode?: unknown; status?: unknown };
  if (isHttpErrorStatus(candidate.statusCode)) return candidate.statusCode;
  if (isHttpErrorStatus(candidate.status)) return candidate.status;
  return undefined;
}
