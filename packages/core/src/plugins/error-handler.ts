import { FastifyInstance, FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

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
 */
export function formatErrorResponse(
  error: { statusCode?: number; message?: string; validation?: unknown },
  isDev: boolean,
): { statusCode: number; body: ErrorBody } {
  const statusCode = error.statusCode ?? 500;
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
