import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  ErrorResponseSchema,
  SuccessResponseSchema,
  LoginResponseSchema,
  SessionResponseSchema,
  RefreshResponseSchema,
  HealthResponseSchema,
  ReadinessResponseSchema,
  ContainerParamsSchema,
  EndpointIdQuerySchema,
  MetricsQuerySchema,
  MetricsResponseSchema,
  InsightsQuerySchema,
  TracesQuerySchema,
  SettingUpdateBodySchema,
  SearchQuerySchema,
  CacheInvalidateQuerySchema,
  ContainerLogsQuerySchema,
} from './api-schemas.js';

describe('api-schemas', () => {
  describe('ErrorResponseSchema', () => {
    it('should accept valid error response', () => {
      const result = ErrorResponseSchema.safeParse({ error: 'Not found' });
      expect(result.success).toBe(true);
    });

    it('should reject missing error field', () => {
      const result = ErrorResponseSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });

  describe('SuccessResponseSchema', () => {
    it('should accept valid success response', () => {
      const result = SuccessResponseSchema.safeParse({ success: true });
      expect(result.success).toBe(true);
    });
  });

  describe('LoginResponseSchema', () => {
    it('should accept valid login response', () => {
      const result = LoginResponseSchema.safeParse({
        token: 'jwt.token.here',
        username: 'admin',
        expiresAt: '2025-01-01T00:00:00Z',
        defaultLandingPage: '/',
      });
      expect(result.success).toBe(true);
    });

    it('should reject missing fields', () => {
      const result = LoginResponseSchema.safeParse({ token: 'abc' });
      expect(result.success).toBe(false);
    });
  });

  describe('SessionResponseSchema', () => {
    it('should accept valid session response', () => {
      const result = SessionResponseSchema.safeParse({
        username: 'admin',
        createdAt: '2025-01-01T00:00:00Z',
        expiresAt: '2025-01-02T00:00:00Z',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('RefreshResponseSchema', () => {
    it('should accept valid refresh response', () => {
      const result = RefreshResponseSchema.safeParse({
        token: 'new.jwt.token',
        expiresAt: '2025-01-02T00:00:00Z',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('HealthResponseSchema', () => {
    it('should accept valid health response', () => {
      const result = HealthResponseSchema.safeParse({
        status: 'ok',
        timestamp: new Date().toISOString(),
      });
      expect(result.success).toBe(true);
    });
  });

  describe('ReadinessResponseSchema', () => {
    it('should accept valid readiness response', () => {
      const result = ReadinessResponseSchema.safeParse({
        status: 'healthy',
        checks: {
          database: { status: 'healthy' },
          portainer: { status: 'healthy', url: 'http://localhost:9000' },
          ollama: { status: 'unhealthy', url: 'http://localhost:11434', error: 'Connection refused' },
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
    it('should accept valid metric types', () => {
      const result = MetricsQuerySchema.safeParse({ metricType: 'cpu' });
      expect(result.success).toBe(true);
    });

    it('should accept empty query', () => {
      const result = MetricsQuerySchema.safeParse({});
      expect(result.success).toBe(true);
    });
  });

  describe('MetricsResponseSchema', () => {
    it('should accept valid metrics response', () => {
      const result = MetricsResponseSchema.safeParse({
        containerId: 'abc123',
        endpointId: 1,
        metricType: 'cpu',
        timeRange: '1h',
        data: [{ timestamp: '2025-01-01T00:00:00Z', value: 42.5 }],
      });
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

    it('should validate severity enum', () => {
      const result = InsightsQuerySchema.safeParse({ severity: 'critical' });
      expect(result.success).toBe(true);
    });

    it('should reject invalid severity', () => {
      const result = InsightsQuerySchema.safeParse({ severity: 'invalid' });
      expect(result.success).toBe(false);
    });
  });

  describe('TracesQuerySchema', () => {
    it('should accept all optional fields', () => {
      const result = TracesQuerySchema.safeParse({
        from: '2025-01-01',
        to: '2025-01-02',
        serviceName: 'api',
        status: 'error',
        minDuration: 100,
        limit: 25,
      });
      expect(result.success).toBe(true);
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
