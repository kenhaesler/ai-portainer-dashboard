import { describe, it, expect } from 'vitest';
import {
  ErrorResponseSchema,
  LoginResponseSchema,
  ReadinessResponseSchema,
  ContainerParamsSchema,
  EndpointIdQuerySchema,
  MetricsQuerySchema,
  InsightsQuerySchema,
  SettingUpdateBodySchema,
  SearchQuerySchema,
  CacheInvalidateQuerySchema,
  ContainerLogsQuerySchema,
} from './api-schemas.js';

describe('api-schemas', () => {
  describe('ErrorResponseSchema', () => {
    it('should reject missing error field', () => {
      const result = ErrorResponseSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });

  describe('LoginResponseSchema', () => {
    it('should reject missing fields', () => {
      const result = LoginResponseSchema.safeParse({ token: 'abc' });
      expect(result.success).toBe(false);
    });
  });

  describe('ReadinessResponseSchema', () => {
    it('should accept readiness response with optional redis', () => {
      const result = ReadinessResponseSchema.safeParse({
        status: 'healthy',
        checks: {
          appDb: { status: 'healthy' },
          metricsDb: { status: 'healthy' },
          portainer: { status: 'healthy' },
          ollama: { status: 'healthy' },
          redis: { status: 'healthy' },
        },
        timestamp: new Date().toISOString(),
      });
      expect(result.success).toBe(true);
    });
  });

  describe('ContainerParamsSchema', () => {
    it('should coerce endpointId to number', () => {
      const result = ContainerParamsSchema.safeParse({
        endpointId: '5',
        containerId: 'abc123',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.endpointId).toBe(5);
      }
    });
  });

  describe('EndpointIdQuerySchema', () => {
    it('should accept empty query', () => {
      const result = EndpointIdQuerySchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it('should coerce string endpointId', () => {
      const result = EndpointIdQuerySchema.safeParse({ endpointId: '3' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.endpointId).toBe(3);
      }
    });
  });

  describe('MetricsQuerySchema', () => {
    it('should accept empty query', () => {
      const result = MetricsQuerySchema.safeParse({});
      expect(result.success).toBe(true);
    });
  });

  describe('InsightsQuerySchema', () => {
    it('should apply defaults', () => {
      const result = InsightsQuerySchema.safeParse({});
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.limit).toBe(50);
        expect(result.data.offset).toBe(0);
      }
    });

    it('should reject invalid severity', () => {
      const result = InsightsQuerySchema.safeParse({ severity: 'invalid' });
      expect(result.success).toBe(false);
    });
  });

  describe('SettingUpdateBodySchema', () => {
    it('should allow omitted category', () => {
      const result = SettingUpdateBodySchema.safeParse({ value: 'test' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.category).toBeUndefined();
      }
    });
  });

  describe('SearchQuerySchema', () => {
    it('should apply defaults', () => {
      const result = SearchQuerySchema.safeParse({});
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.limit).toBe(8);
        expect(result.data.logLimit).toBe(8);
      }
    });
  });

  describe('CacheInvalidateQuerySchema', () => {
    it('should accept valid resources', () => {
      for (const resource of ['endpoints', 'containers', 'images', 'networks', 'stacks']) {
        const result = CacheInvalidateQuerySchema.safeParse({ resource });
        expect(result.success).toBe(true);
      }
    });

    it('should reject invalid resource', () => {
      const result = CacheInvalidateQuerySchema.safeParse({ resource: 'invalid' });
      expect(result.success).toBe(false);
    });
  });

  describe('ContainerLogsQuerySchema', () => {
    it('should apply defaults', () => {
      const result = ContainerLogsQuerySchema.safeParse({});
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.tail).toBe(100);
        expect(result.data.timestamps).toBe(true);
      }
    });

    it('should parse string false for timestamps', () => {
      const result = ContainerLogsQuerySchema.safeParse({ timestamps: 'false' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.timestamps).toBe(false);
      }
    });
  });
});
