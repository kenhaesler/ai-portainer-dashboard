import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';

async function swaggerPlugin(fastify: FastifyInstance) {
  await fastify.register(swagger, {
    openapi: {
      info: {
        title: 'AI Portainer Dashboard API',
        description: 'Intelligent container operations platform API',
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
    },
  });

  await fastify.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true,
    },
  });
}

export default fp(swaggerPlugin, { name: 'swagger' });
