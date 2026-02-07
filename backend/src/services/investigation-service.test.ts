import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Insight } from '../models/monitoring.js';

// Mock dependencies before importing the module under test
vi.mock('../config/index.js', () => ({
  getConfig: () => ({
    INVESTIGATION_ENABLED: true,
    INVESTIGATION_COOLDOWN_MINUTES: 30,
    INVESTIGATION_MAX_CONCURRENT: 2,
    INVESTIGATION_LOG_TAIL_LINES: 50,
    INVESTIGATION_METRICS_WINDOW_MINUTES: 60,
    OLLAMA_MODEL: 'llama3.2',
  }),
}));

vi.mock('../utils/logger.js', () => ({
  createChildLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

const mockGetContainerLogs = vi.fn();
const mockGetContainers = vi.fn();
vi.mock('./portainer-client.js', () => ({
  getContainerLogs: (...args: unknown[]) => mockGetContainerLogs(...args),
  getContainers: (...args: unknown[]) => mockGetContainers(...args),
}));

const mockGetMetrics = vi.fn();
const mockGetMovingAverage = vi.fn();
vi.mock('./metrics-store.js', () => ({
  getMetrics: (...args: unknown[]) => mockGetMetrics(...args),
  getMovingAverage: (...args: unknown[]) => mockGetMovingAverage(...args),
}));

const mockIsOllamaAvailable = vi.fn();
const mockChatStream = vi.fn();
vi.mock('./llm-client.js', () => ({
  isOllamaAvailable: () => mockIsOllamaAvailable(),
  chatStream: (...args: unknown[]) => mockChatStream(...args),
}));

const mockInsertInvestigation = vi.fn();
const mockUpdateInvestigationStatus = vi.fn();
const mockGetInvestigation = vi.fn();
const mockGetRecentInvestigationForContainer = vi.fn();
vi.mock('./investigation-store.js', () => ({
  insertInvestigation: (...args: unknown[]) => mockInsertInvestigation(...args),
  updateInvestigationStatus: (...args: unknown[]) => mockUpdateInvestigationStatus(...args),
  getInvestigation: (...args: unknown[]) => mockGetInvestigation(...args),
  getRecentInvestigationForContainer: (...args: unknown[]) => mockGetRecentInvestigationForContainer(...args),
}));

const mockGenerateForecast = vi.fn();
vi.mock('./capacity-forecaster.js', () => ({
  generateForecast: (...args: unknown[]) => mockGenerateForecast(...args),
}));

// Import after mocks are set up
const { parseInvestigationResponse, buildInvestigationPrompt, triggerInvestigation } =
  await import('./investigation-service.js');

function makeInsight(overrides?: Partial<Insight>): Insight {
  return {
    id: 'insight-1',
    endpoint_id: 1,
    endpoint_name: 'local',
    container_id: 'abc123',
    container_name: 'web-app',
    severity: 'warning',
    category: 'anomaly',
    title: 'Anomalous cpu usage on "web-app"',
    description: 'Current cpu: 95.0% (mean: 40.0%, z-score: 3.50).',
    suggested_action: 'Check for runaway processes',
    is_acknowledged: 0,
    created_at: '2026-02-05T12:00:00.000Z',
    ...overrides,
  };
}

describe('investigation-service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('parseInvestigationResponse', () => {
    it('should parse valid JSON response', () => {
      const json = JSON.stringify({
        root_cause: 'Memory leak in Node.js process',
        contributing_factors: ['No garbage collection', 'Large dataset in memory'],
        severity_assessment: 'critical',
        recommended_actions: [
          { action: 'Restart the container', priority: 'high', rationale: 'Immediate relief' },
          { action: 'Profile memory usage', priority: 'medium' },
        ],
        confidence_score: 0.85,
      });

      const result = parseInvestigationResponse(json);

      expect(result.root_cause).toBe('Memory leak in Node.js process');
      expect(result.contributing_factors).toEqual(['No garbage collection', 'Large dataset in memory']);
      expect(result.severity_assessment).toBe('critical');
      expect(result.recommended_actions).toHaveLength(2);
      expect(result.recommended_actions[0].action).toBe('Restart the container');
      expect(result.recommended_actions[0].priority).toBe('high');
      expect(result.recommended_actions[0].rationale).toBe('Immediate relief');
      expect(result.confidence_score).toBe(0.85);
    });

    it('should parse JSON from markdown code fences', () => {
      const response = `Here is my analysis:

\`\`\`json
{
  "root_cause": "CPU spike from background job",
  "contributing_factors": ["Cron job overlap"],
  "severity_assessment": "warning",
  "recommended_actions": [{"action": "Stagger cron jobs", "priority": "medium"}],
  "confidence_score": 0.7
}
\`\`\`

Hope this helps!`;

      const result = parseInvestigationResponse(response);

      expect(result.root_cause).toBe('CPU spike from background job');
      expect(result.contributing_factors).toEqual(['Cron job overlap']);
      expect(result.confidence_score).toBe(0.7);
    });

    it('should parse JSON from code fences without language specifier', () => {
      const response = `\`\`\`
{"root_cause":"Test","contributing_factors":[],"severity_assessment":"info","recommended_actions":[],"confidence_score":0.5}
\`\`\``;

      const result = parseInvestigationResponse(response);
      expect(result.root_cause).toBe('Test');
    });

    it('should fall back to raw text with low confidence', () => {
      const response = 'The container is experiencing high CPU due to a runaway process.';

      const result = parseInvestigationResponse(response);

      expect(result.root_cause).toBe(response);
      expect(result.contributing_factors).toEqual([]);
      expect(result.severity_assessment).toBe('unknown');
      expect(result.recommended_actions).toEqual([]);
      expect(result.confidence_score).toBe(0.3);
    });

    it('should handle missing fields gracefully', () => {
      const json = JSON.stringify({
        root_cause: 'Something went wrong',
      });

      const result = parseInvestigationResponse(json);

      expect(result.root_cause).toBe('Something went wrong');
      expect(result.contributing_factors).toEqual([]);
      expect(result.severity_assessment).toBe('unknown');
      expect(result.recommended_actions).toEqual([]);
      expect(result.confidence_score).toBe(0.5);
    });

    it('should clamp confidence_score to [0, 1]', () => {
      const json = JSON.stringify({
        root_cause: 'Test',
        confidence_score: 1.5,
      });

      const result = parseInvestigationResponse(json);
      expect(result.confidence_score).toBe(1.0);
    });

    it('should handle negative confidence_score', () => {
      const json = JSON.stringify({
        root_cause: 'Test',
        confidence_score: -0.5,
      });

      const result = parseInvestigationResponse(json);
      expect(result.confidence_score).toBe(0);
    });

    it('should handle invalid priority in recommended_actions', () => {
      const json = JSON.stringify({
        root_cause: 'Test',
        recommended_actions: [
          { action: 'Do something', priority: 'super-high' },
        ],
      });

      const result = parseInvestigationResponse(json);
      expect(result.recommended_actions[0].priority).toBe('medium');
    });

    it('should handle string-only recommended_actions', () => {
      const json = JSON.stringify({
        root_cause: 'Test',
        recommended_actions: ['Action 1', 'Action 2'],
      });

      const result = parseInvestigationResponse(json);
      expect(result.recommended_actions).toHaveLength(2);
      expect(result.recommended_actions[0].action).toBe('Action 1');
      expect(result.recommended_actions[0].priority).toBe('medium');
    });

    it('should handle non-string contributing_factors', () => {
      const json = JSON.stringify({
        root_cause: 'Test',
        contributing_factors: [42, 'valid factor', null, true],
      });

      const result = parseInvestigationResponse(json);
      expect(result.contributing_factors).toEqual(['valid factor']);
    });

    it('should truncate long raw text fallback to 2000 chars', () => {
      const longText = 'x'.repeat(3000);
      const result = parseInvestigationResponse(longText);
      expect(result.root_cause.length).toBe(2000);
    });

    it('should extract ai_summary from JSON response', () => {
      const json = JSON.stringify({
        root_cause: 'Memory leak in Node.js process',
        ai_summary: 'Container web-app has a memory leak causing OOM kills.',
        confidence_score: 0.85,
      });

      const result = parseInvestigationResponse(json);
      expect(result.ai_summary).toBe('Container web-app has a memory leak causing OOM kills.');
    });

    it('should generate fallback ai_summary from root_cause when ai_summary missing', () => {
      const json = JSON.stringify({
        root_cause: 'Memory leak in Node.js process due to unclosed database connections',
      });

      const result = parseInvestigationResponse(json);
      expect(result.ai_summary).toBe('Memory leak in Node.js process due to unclosed database connections');
    });

    it('should truncate ai_summary to 200 chars', () => {
      const json = JSON.stringify({
        root_cause: 'Test',
        ai_summary: 'x'.repeat(300),
      });

      const result = parseInvestigationResponse(json);
      expect(result.ai_summary.length).toBe(200);
    });

    it('should generate ai_summary from raw text fallback', () => {
      const response = 'The container is experiencing high CPU due to a runaway process.';
      const result = parseInvestigationResponse(response);
      expect(result.ai_summary).toBe(response);
    });
  });

  describe('buildInvestigationPrompt', () => {
    it('should include insight details in the prompt', () => {
      const insight = makeInsight();
      const prompt = buildInvestigationPrompt(insight, {});

      expect(prompt).toContain(insight.title);
      expect(prompt).toContain(insight.description);
      expect(prompt).toContain(insight.severity);
      expect(prompt).toContain(insight.container_name!);
      expect(prompt).toContain(insight.endpoint_name!);
    });

    it('should include logs section when logs are provided', () => {
      const insight = makeInsight();
      const prompt = buildInvestigationPrompt(insight, {
        logs: '2026-02-05T12:00:00Z ERROR: Out of memory',
      });

      expect(prompt).toContain('Recent Container Logs');
      expect(prompt).toContain('Out of memory');
    });

    it('should include metrics section when metrics are provided', () => {
      const insight = makeInsight();
      const prompt = buildInvestigationPrompt(insight, {
        metrics: [
          { metric_type: 'cpu', current: 95.0, mean: 40.0, std_dev: 15.5, sample_count: 30 },
          { metric_type: 'memory', current: 78.5, mean: 60.0, std_dev: 10.0, sample_count: 30 },
        ],
      });

      expect(prompt).toContain('Metrics Summary');
      expect(prompt).toContain('cpu');
      expect(prompt).toContain('memory');
      expect(prompt).toContain('95.0%');
    });

    it('should include related containers section', () => {
      const insight = makeInsight();
      const prompt = buildInvestigationPrompt(insight, {
        relatedContainers: ['nginx (running)', 'redis (running)', 'postgres (exited)'],
      });

      expect(prompt).toContain('Related Containers on Same Endpoint');
      expect(prompt).toContain('nginx (running)');
      expect(prompt).toContain('postgres (exited)');
    });

    it('should include JSON format instructions with ai_summary', () => {
      const insight = makeInsight();
      const prompt = buildInvestigationPrompt(insight, {});

      expect(prompt).toContain('root_cause');
      expect(prompt).toContain('contributing_factors');
      expect(prompt).toContain('recommended_actions');
      expect(prompt).toContain('confidence_score');
      expect(prompt).toContain('ai_summary');
      expect(prompt).toContain('JSON');
    });

    it('should include capacity forecast section when forecasts provided', () => {
      const insight = makeInsight();
      const prompt = buildInvestigationPrompt(insight, {
        forecasts: [
          {
            containerId: 'abc123',
            containerName: 'web-app',
            metricType: 'cpu',
            currentValue: 85.0,
            trend: 'increasing',
            slope: 1.5,
            r_squared: 0.82,
            forecast: [],
            timeToThreshold: 3,
            confidence: 'high',
          },
        ],
      });

      expect(prompt).toContain('Capacity Forecast');
      expect(prompt).toContain('cpu');
      expect(prompt).toContain('increasing');
      expect(prompt).toContain('3h');
      expect(prompt).toContain('high');
    });

    it('should show N/A for timeToThreshold when null', () => {
      const insight = makeInsight();
      const prompt = buildInvestigationPrompt(insight, {
        forecasts: [
          {
            containerId: 'abc123',
            containerName: 'web-app',
            metricType: 'memory',
            currentValue: 50.0,
            trend: 'stable',
            slope: 0.01,
            r_squared: 0.1,
            forecast: [],
            timeToThreshold: null,
            confidence: 'low',
          },
        ],
      });

      expect(prompt).toContain('time-to-threshold=N/A');
    });

    it('should handle null container_id and container_name', () => {
      const insight = makeInsight({ container_id: null, container_name: null });
      const prompt = buildInvestigationPrompt(insight, {});

      expect(prompt).toContain('N/A');
    });
  });

  describe('triggerInvestigation', () => {
    it('should skip when investigation is disabled', async () => {
      vi.doMock('../config/index.js', () => ({
        getConfig: () => ({
          INVESTIGATION_ENABLED: false,
          INVESTIGATION_COOLDOWN_MINUTES: 30,
          INVESTIGATION_MAX_CONCURRENT: 2,
          INVESTIGATION_LOG_TAIL_LINES: 50,
          INVESTIGATION_METRICS_WINDOW_MINUTES: 60,
        }),
      }));

      // Re-import with new config
      const mod = await import('./investigation-service.js');
      const insight = makeInsight();
      await mod.triggerInvestigation(insight);

      expect(mockInsertInvestigation).not.toHaveBeenCalled();

      // Restore original mock
      vi.doMock('../config/index.js', () => ({
        getConfig: () => ({
          INVESTIGATION_ENABLED: true,
          INVESTIGATION_COOLDOWN_MINUTES: 30,
          INVESTIGATION_MAX_CONCURRENT: 2,
          INVESTIGATION_LOG_TAIL_LINES: 50,
          INVESTIGATION_METRICS_WINDOW_MINUTES: 60,
          OLLAMA_MODEL: 'llama3.2',
        }),
      }));
    });

    it('should skip when no container context', async () => {
      const insight = makeInsight({ container_id: null, endpoint_id: null });
      await triggerInvestigation(insight);

      expect(mockInsertInvestigation).not.toHaveBeenCalled();
    });

    it('should skip when missing container_id', async () => {
      const insight = makeInsight({ container_id: null });
      await triggerInvestigation(insight);

      expect(mockInsertInvestigation).not.toHaveBeenCalled();
    });

    it('should skip when missing endpoint_id', async () => {
      const insight = makeInsight({ endpoint_id: null });
      await triggerInvestigation(insight);

      expect(mockInsertInvestigation).not.toHaveBeenCalled();
    });

    it('should skip when a recent investigation exists (DB cooldown)', async () => {
      mockGetRecentInvestigationForContainer.mockReturnValue({
        id: 'existing-inv',
        status: 'complete',
      });
      mockIsOllamaAvailable.mockResolvedValue(true);

      const insight = makeInsight();
      await triggerInvestigation(insight);

      expect(mockInsertInvestigation).not.toHaveBeenCalled();
    });

    it('should skip when LLM is not available', async () => {
      mockGetRecentInvestigationForContainer.mockReturnValue(undefined);
      mockIsOllamaAvailable.mockResolvedValue(false);

      const insight = makeInsight();
      await triggerInvestigation(insight);

      expect(mockInsertInvestigation).not.toHaveBeenCalled();
    });

    it('should create investigation when all guards pass', async () => {
      mockGetRecentInvestigationForContainer.mockReturnValue(undefined);
      mockIsOllamaAvailable.mockResolvedValue(true);
      mockChatStream.mockResolvedValue('{"root_cause":"test","contributing_factors":[],"severity_assessment":"info","recommended_actions":[],"confidence_score":0.5}');

      // Mock evidence gathering
      mockGetContainerLogs.mockResolvedValue('some logs');
      mockGetMovingAverage.mockReturnValue({ mean: 50, std_dev: 10, sample_count: 30 });
      mockGetMetrics.mockReturnValue([{ value: 60 }]);
      mockGetContainers.mockResolvedValue([]);
      mockGetInvestigation.mockReturnValue({ id: 'inv-1', status: 'complete' });

      const insight = makeInsight();
      await triggerInvestigation(insight);

      expect(mockInsertInvestigation).toHaveBeenCalledWith(
        expect.objectContaining({
          insight_id: 'insight-1',
          endpoint_id: 1,
          container_id: 'abc123',
          container_name: 'web-app',
        }),
      );
    });
  });
});
