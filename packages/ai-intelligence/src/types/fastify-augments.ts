/**
 * Side-effect imports that bring in Fastify type augmentations.
 * These imports ensure fastify.authenticate, fastify.requireRole,
 * request.user, request.requestId, and swagger schema properties
 * are available in route files.
 */
import '@dashboard/core/plugins/auth.js';
import '@dashboard/core/plugins/request-tracing.js';
import '@fastify/swagger';
