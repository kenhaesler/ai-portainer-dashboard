import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod';

async function swaggerPlugin(fastify: FastifyInstance) {
  // Set up Zod type provider compilers
  fastify.setValidatorCompiler(validatorCompiler);
  fastify.setSerializerCompiler(serializerCompiler);

  await fastify.register(swagger, {
    openapi: {
      info: {
        title: 'AI Portainer Dashboard API',
        description:
          'Intelligent container operations platform API. ' +
          'Authenticate via `POST /api/auth/login` to obtain a JWT token, ' +
          'then use it as a Bearer token in the Authorize dialog.',
        version: '2.0.0',
      },
      servers: [{ url: 'http://localhost:3051' }],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
          },
        },
      },
      tags: [
        { name: 'Health', description: 'Liveness and readiness probes' },
        { name: 'Auth', description: 'Authentication and session management' },
        { name: 'Dashboard', description: 'Dashboard summary and KPIs' },
        { name: 'Endpoints', description: 'Portainer endpoint management' },
        { name: 'Containers', description: 'Container listing and details' },
        { name: 'Stacks', description: 'Stack management' },
        { name: 'Metrics', description: 'Container metrics and anomaly detection' },
        { name: 'Monitoring', description: 'AI-powered monitoring insights' },
        { name: 'Remediation', description: 'Remediation action workflow' },
        { name: 'Traces', description: 'Distributed tracing' },
        { name: 'Investigations', description: 'AI root-cause investigations' },
        { name: 'Backup', description: 'Database backup management' },
        { name: 'Settings', description: 'Application settings and audit log' },
        { name: 'Logs', description: 'Elasticsearch/Kibana log search' },
        { name: 'Images', description: 'Docker image inventory' },
        { name: 'Networks', description: 'Docker network topology' },
        { name: 'Search', description: 'Global search across resources' },
        { name: 'Notifications', description: 'Notification channels and history' },
        { name: 'Cache Admin', description: 'Cache statistics and invalidation' },
        { name: 'Packet Capture', description: 'Network packet capture (tcpdump)' },
      ],
    },
    transform: jsonSchemaTransform,
  });

  await fastify.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true,
      persistAuthorization: true,
    },
  });
}

export default fp(swaggerPlugin, { name: 'swagger' });
