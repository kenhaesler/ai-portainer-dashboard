/**
 * Test application factory for integration tests
 * Creates a minimal Fastify instance for testing routes
 */

import Fastify, { FastifyInstance } from 'fastify';

export interface TestAppOptions {
  // Add options for customizing test app if needed
}

export async function createTestApp(_options: TestAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false, // Disable logging in tests
  });

  // Register any common plugins needed for tests

  return app;
}

export async function closeTestApp(app: FastifyInstance): Promise<void> {
  await app.close();
}
