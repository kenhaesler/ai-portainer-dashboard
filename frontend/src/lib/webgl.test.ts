import { describe, it, expect } from 'vitest';
import { isWebGLAvailable } from './webgl';

describe('isWebGLAvailable', () => {
  it('returns true when a WebGL context is available', () => {
    const result = isWebGLAvailable(() => ({
      getContext: () => ({}),
    } as unknown as HTMLCanvasElement));

    expect(result).toBe(true);
  });

  it('returns false when no context is available', () => {
    const result = isWebGLAvailable(() => ({
      getContext: () => null,
    } as unknown as HTMLCanvasElement));

    expect(result).toBe(false);
  });

  it('returns false when canvas creation throws', () => {
    const result = isWebGLAvailable(() => {
      throw new Error('boom');
    });

    expect(result).toBe(false);
  });
});
