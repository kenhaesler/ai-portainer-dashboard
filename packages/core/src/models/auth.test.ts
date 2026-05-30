import { describe, it, expect } from 'vitest';
import { LoginRequestSchema } from './auth.js';

describe('LoginRequestSchema', () => {
  it('should validate a correct login request', () => {
    const validRequest = {
      username: 'admin',
      password: 'password123',
    };

    const result = LoginRequestSchema.safeParse(validRequest);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.username).toBe('admin');
      expect(result.data.password).toBe('password123');
    }
  });

  it('should reject empty username', () => {
    const invalidRequest = {
      username: '',
      password: 'password123',
    };

    const result = LoginRequestSchema.safeParse(invalidRequest);
    expect(result.success).toBe(false);
  });

  it('should reject empty password', () => {
    const invalidRequest = {
      username: 'admin',
      password: '',
    };

    const result = LoginRequestSchema.safeParse(invalidRequest);
    expect(result.success).toBe(false);
  });

  it('should reject missing fields', () => {
    const invalidRequest = {
      username: 'admin',
    };

    const result = LoginRequestSchema.safeParse(invalidRequest);
    expect(result.success).toBe(false);
  });

  it('should reject non-string values', () => {
    const invalidRequest = {
      username: 123,
      password: 'password123',
    };

    const result = LoginRequestSchema.safeParse(invalidRequest);
    expect(result.success).toBe(false);
  });
});
