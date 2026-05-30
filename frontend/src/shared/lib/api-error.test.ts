import { describe, it, expect } from 'vitest';
import { ApiError } from './api-error';

describe('ApiError', () => {
  it('stores status, userMessage, and requestId', () => {
    const err = new ApiError(500, 'Internal server error', 'req-123');
    expect(err.status).toBe(500);
    expect(err.userMessage).toBe('Internal server error');
    expect(err.requestId).toBe('req-123');
    expect(err.message).toBe('Internal server error');
    expect(err.name).toBe('ApiError');
  });

  it('is an instance of Error', () => {
    const err = new ApiError(404, 'Not found');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ApiError);
  });

  it('works without requestId', () => {
    const err = new ApiError(503, 'Service unavailable');
    expect(err.requestId).toBeUndefined();
  });
});
