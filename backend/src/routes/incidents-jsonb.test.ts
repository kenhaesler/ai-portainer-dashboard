import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getTestDb, truncateTestTables, closeTestDb } from '../db/test-db-helper.js';
import { insertIncident, getIncident, addInsightToIncident } from '../services/incident-store.js';
import type { IncidentInsert } from '../services/incident-store.js';

describe('Incidents JSONB Type Regression Tests', () => {
  beforeEach(async () => {
    await truncateTestTables('incidents');
    await truncateTestTables('insights');
  });

  afterEach(async () => {
    await closeTestDb();
  });

  describe('JSONB deserialization', () => {
    it('should return JSONB columns as native arrays (not strings)', async () => {
      const incident: IncidentInsert = {
        id: 'test-incident-1',
        title: 'JSONB Test Incident',
        severity: 'warning',
        root_cause_insight_id: 'insight-root',
        related_insight_ids: ['insight-1', 'insight-2', 'insight-3'],
        affected_containers: ['container-a', 'container-b'],
        endpoint_id: 1,
        endpoint_name: 'test-endpoint',
        correlation_type: 'temporal',
        correlation_confidence: 'high',
        insight_count: 4,
        summary: 'Test summary',
      };

      await insertIncident(incident);
      const retrieved = await getIncident('test-incident-1');

      expect(retrieved).not.toBeNull();
      expect(retrieved!.related_insight_ids).toBeInstanceOf(Array);
      expect(retrieved!.affected_containers).toBeInstanceOf(Array);

      // Verify exact values
      expect(retrieved!.related_insight_ids).toEqual(['insight-1', 'insight-2', 'insight-3']);
      expect(retrieved!.affected_containers).toEqual(['container-a', 'container-b']);
    });

    it('should handle empty JSONB arrays correctly', async () => {
      const incident: IncidentInsert = {
        id: 'test-incident-empty',
        title: 'Empty Arrays Test',
        severity: 'info',
        root_cause_insight_id: null,
        related_insight_ids: [],
        affected_containers: [],
        endpoint_id: null,
        endpoint_name: null,
        correlation_type: 'dedup',
        correlation_confidence: 'low',
        insight_count: 1,
        summary: null,
      };

      await insertIncident(incident);
      const retrieved = await getIncident('test-incident-empty');

      expect(retrieved!.related_insight_ids).toEqual([]);
      expect(retrieved!.affected_containers).toEqual([]);
    });

    it('should update JSONB arrays without JSON.parse() errors', async () => {
      // Setup: Create incident with initial arrays
      const incident: IncidentInsert = {
        id: 'test-incident-update',
        title: 'Update Test',
        severity: 'critical',
        root_cause_insight_id: 'root-1',
        related_insight_ids: ['insight-1'],
        affected_containers: ['container-1'],
        endpoint_id: 1,
        endpoint_name: 'endpoint-1',
        correlation_type: 'cascade',
        correlation_confidence: 'medium',
        insight_count: 2,
        summary: 'Initial state',
      };

      await insertIncident(incident);

      // Update: Add insight to incident (tests addInsightToIncident function)
      await addInsightToIncident('test-incident-update', 'insight-2', 'container-2');

      // Verify: Arrays should be updated
      const updated = await getIncident('test-incident-update');
      expect(updated!.related_insight_ids).toContain('insight-2');
      expect(updated!.affected_containers).toContain('container-2');
    });
  });

  describe('Type safety validation', () => {
    it('should reject non-array values for JSONB columns', async () => {
      const db = await getTestDb();

      // Attempt to insert malformed data directly via SQL
      await expect(
        db.execute(`
          INSERT INTO incidents (
            id, title, severity, related_insight_ids, affected_containers,
            correlation_type, correlation_confidence, insight_count
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          'bad-incident',
          'Bad Data',
          'info',
          '"not-an-array"', // String instead of array
          '[]',
          'temporal',
          'low',
          1,
        ])
      ).rejects.toThrow(); // PostgreSQL should reject invalid JSONB
    });
  });

  describe('API endpoint integration', () => {
    it('GET /api/incidents/:id should work with arrays without JSON.parse()', async () => {
      const incident: IncidentInsert = {
        id: 'api-test-1',
        title: 'API Test',
        severity: 'warning',
        root_cause_insight_id: 'root-api',
        related_insight_ids: ['api-insight-1', 'api-insight-2'],
        affected_containers: ['api-container'],
        endpoint_id: 5,
        endpoint_name: 'api-endpoint',
        correlation_type: 'semantic',
        correlation_confidence: 'high',
        insight_count: 3,
        summary: 'API integration test',
      };

      await insertIncident(incident);
      const retrieved = await getIncident('api-test-1');

      // Simulate what the route does (line 50 in incidents.ts)
      const relatedIds: string[] = retrieved!.related_insight_ids;

      // Should work without JSON.parse()
      expect(relatedIds).toBeInstanceOf(Array);
      expect(relatedIds).toHaveLength(2);
      expect(relatedIds[0]).toBe('api-insight-1');
    });

    it('should handle incidents with many affected containers', async () => {
      const manyContainers = Array.from({ length: 20 }, (_, i) => `container-${i}`);
      const incident: IncidentInsert = {
        id: 'many-containers-test',
        title: 'Large Scale Incident',
        severity: 'critical',
        root_cause_insight_id: 'root-large',
        related_insight_ids: ['insight-1', 'insight-2', 'insight-3'],
        affected_containers: manyContainers,
        endpoint_id: 1,
        endpoint_name: 'production',
        correlation_type: 'cascade',
        correlation_confidence: 'high',
        insight_count: 4,
        summary: 'Cascading failure across multiple containers',
      };

      await insertIncident(incident);
      const retrieved = await getIncident('many-containers-test');

      expect(retrieved!.affected_containers).toHaveLength(20);
      expect(retrieved!.affected_containers[0]).toBe('container-0');
      expect(retrieved!.affected_containers[19]).toBe('container-19');
    });
  });

  describe('Regression: JSON.parse() removed', () => {
    it('should not attempt to parse JSONB fields that are already arrays', async () => {
      const incident: IncidentInsert = {
        id: 'regression-test',
        title: 'Regression Test - No Double Parse',
        severity: 'warning',
        root_cause_insight_id: null,
        related_insight_ids: ['id-1', 'id-2'],
        affected_containers: ['ctr-1'],
        endpoint_id: 1,
        endpoint_name: 'test',
        correlation_type: 'temporal',
        correlation_confidence: 'medium',
        insight_count: 2,
        summary: null,
      };

      await insertIncident(incident);
      const retrieved = await getIncident('regression-test');

      // This would have thrown "JSON Parse error: Unexpected identifier 'docker'"
      // if we still had JSON.parse() on already-parsed JSONB arrays
      expect(() => {
        const ids = retrieved!.related_insight_ids; // Should be array already
        expect(ids).toBeInstanceOf(Array);
      }).not.toThrow();
    });
  });
});
