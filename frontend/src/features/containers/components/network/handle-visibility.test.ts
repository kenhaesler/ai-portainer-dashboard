import { describe, it, expect } from 'vitest';
import { shouldShowHandle } from './handle-visibility';

describe('shouldShowHandle', () => {
  it('shows every handle when usedHandles is undefined (fallback)', () => {
    expect(shouldShowHandle(undefined, 'top')).toBe(true);
    expect(shouldShowHandle(undefined, 'right')).toBe(true);
    expect(shouldShowHandle(undefined, 'bottom')).toBe(true);
    expect(shouldShowHandle(undefined, 'left')).toBe(true);
  });

  it('shows no handle when usedHandles is an empty array', () => {
    expect(shouldShowHandle([], 'top')).toBe(false);
    expect(shouldShowHandle([], 'right')).toBe(false);
    expect(shouldShowHandle([], 'bottom')).toBe(false);
    expect(shouldShowHandle([], 'left')).toBe(false);
  });

  it('shows only the handles listed in usedHandles', () => {
    expect(shouldShowHandle(['top', 'left'], 'top')).toBe(true);
    expect(shouldShowHandle(['top', 'left'], 'left')).toBe(true);
    expect(shouldShowHandle(['top', 'left'], 'right')).toBe(false);
    expect(shouldShowHandle(['top', 'left'], 'bottom')).toBe(false);
  });
});
