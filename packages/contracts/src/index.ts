/**
 * @dashboard/contracts
 *
 * Shared Zod schemas, typed event definitions, and service interfaces.
 * This package is the foundation of Phase 3 — every domain package depends on it.
 *
 * Zero runtime dependencies except `zod` (provided by the workspace).
 */
export * from './schemas/index.js';
export * from './events.js';
export * from './interfaces/index.js';
