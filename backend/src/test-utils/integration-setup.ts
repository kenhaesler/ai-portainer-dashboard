/**
 * Shared integration test setup helpers.
 * Import in test files that use real services instead of mocks.
 */
import { flushTestCache, closeTestRedis } from './test-redis-helper.js';
import { isPortainerAvailable } from './test-portainer-helper.js';
import { isOllamaAvailable } from './test-ollama-helper.js';
import { afterAll, beforeEach } from 'vitest';

/** Cached availability checks — resolved once per test run */
let _portainerAvailable: boolean | null = null;
let _ollamaAvailable: boolean | null = null;

export async function checkPortainerAvailable(): Promise<boolean> {
  if (_portainerAvailable === null) {
    _portainerAvailable = await isPortainerAvailable();
  }
  return _portainerAvailable;
}

export async function checkOllamaAvailable(): Promise<boolean> {
  if (_ollamaAvailable === null) {
    _ollamaAvailable = await isOllamaAvailable();
  }
  return _ollamaAvailable;
}

/**
 * Standard integration test lifecycle hooks.
 * Call at the top of describe() blocks that use real services.
 *
 * Usage:
 *   describe('my integration test', () => {
 *     setupIntegrationTest();
 *     it('works', async () => { ... });
 *   });
 */
export function setupIntegrationTest() {
  beforeEach(async () => {
    await flushTestCache();
  });

  afterAll(async () => {
    await closeTestRedis();
  });
}
