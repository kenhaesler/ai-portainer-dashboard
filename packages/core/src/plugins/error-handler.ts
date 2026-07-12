import { FastifyInstance, FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { getErrorStatusCode } from '../utils/http-error.js';

export interface ErrorBody {
  error: string;
  details?: unknown;
}

/**
 * Pure formatter for the global error handler (exported for testing).
 *
 * Fastify's default handler reflects `error.message` verbatim with no
 * production gating, so an uncaught DB/internal error can leak SQL text,
 * internal paths, or schema detail to the client. This formatter:
 *   - preserves client-facing 4xx errors (validation, explicit statusCode),
 *     including Fastify's validation `details`, so API behaviour is unchanged;
 *   - replaces 5xx bodies with a generic "Internal Server Error" in production
 *     (the real message is still logged server-side), and surfaces the real
 *     message only in development for debuggability.
 *
 * The status is resolved via getErrorStatusCode(), which honours both the
 * canonical `statusCode` spelling and the legacy `status` spelling carried
 * by PortainerError and fetch-style upstream errors (#1511) — previously a
 * `.status`-only error was misreported as a 500.
 */
export function formatErrorResponse(
  error: { statusCode?: number; status?: number; message?: string; validation?: unknown },
  isDev: boolean,
): { statusCode: number; body: ErrorBody } {
  const statusCode = getErrorStatusCode(error) ?? 500;
  if (statusCode >= 500) {
    return {
      statusCode,
      body: { error: isDev ? (error.message || 'Internal Server Error') : 'Internal Server Error' },
    };
  }
  const body: ErrorBody = { error: error.message ?? 'Bad Request' };
  if (error.validation) body.details = error.validation;
  return { statusCode, body };
}

/**
 * Details value for handler-caught 5xx responses (#1518).
 *
 * The global error handler below masks 5xx bodies in production, but only
 * for errors that THROW and propagate to setErrorHandler. Route handlers
 * that catch an error and reply with an explicit
 * `reply.code(5xx).send({ error, details })` bypass it — and a raw
 * `err.message` can carry SQL fragments, table names, internal hostnames,
 * or filesystem paths. Use this helper for the `details` field of every
 * explicit 5xx send: it surfaces the underlying message in development and
 * returns undefined in production so the field is omitted from the JSON
 * body (the full error is still logged server-side).
 *
 * NODE_ENV is read at call time so tests can toggle production behaviour.
 */
export function errorDetails(err: unknown): unknown {
  if (process.env.NODE_ENV === 'production') return undefined;
  if (err instanceof Error) return err.message;
  return err ?? 'Unknown error';
}

async function errorHandlerPlugin(fastify: FastifyInstance) {
  const isDev = process.env.NODE_ENV !== 'production';
  fastify.setErrorHandler((error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
    const { statusCode, body } = formatErrorResponse(error, isDev);
    if (statusCode >= 500) {
      request.log.error({ err: error, reqId: request.id }, 'Unhandled request error');
    }
    return reply.code(statusCode).send(body);
  });
}

export default fp(errorHandlerPlugin, { name: 'error-handler' });
