import { describe, expect, it } from 'vitest';
import { STACK_STATUSES, StackStatusSchema } from './stack.js';

describe('stack status contract', () => {
  it('includes every normalized Portainer lifecycle state', () => {
    expect(STACK_STATUSES).toEqual(['active', 'inactive', 'deploying', 'error', 'unknown']);
    for (const status of STACK_STATUSES) expect(StackStatusSchema.parse(status)).toBe(status);
    expect(StackStatusSchema.safeParse('stopped').success).toBe(false);
  });
});
