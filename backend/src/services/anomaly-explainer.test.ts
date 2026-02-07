import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { InsightInsert } from './insights-store.js';

vi.mock('../utils/logger.js', () => ({
  createChildLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

const mockChatStream = vi.fn();
vi.mock('./llm-client.js', () => ({
  chatStream: (...args: unknown[]) => mockChatStream(...args),
}));

const { explainAnomaly, explainAnomalies } = await import('./anomaly-explainer.js');

function makeInsight(overrides?: Partial<InsightInsert>): InsightInsert {
  return {
    id: 'insight-1',
    endpoint_id: 1,
    endpoint_name: 'local',
    container_id: 'abc123',
    container_name: 'web-app',
    severity: 'warning',
    category: 'anomaly',
    title: 'Anomalous cpu usage on "web-app"',
    description: 'Current cpu: 95.0%',
    suggested_action: 'Check for runaway processes',
    ...overrides,
  };
}

describe('anomaly-explainer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('explainAnomaly', () => {
    it('returns explanation on success', async () => {
      mockChatStream.mockImplementation(
        async (_msgs: unknown, _sys: unknown, onChunk: (c: string) => void) => {
          onChunk('The CPU usage is significantly above normal. ');
          onChunk('This likely indicates a runaway process.');
          return '';
        },
      );

      const insight = makeInsight();
      const result = await explainAnomaly(insight, 'Current cpu: 95.0% (mean: 40.0%, z-score: 3.50)');

      expect(result).toBe(
        'The CPU usage is significantly above normal. This likely indicates a runaway process.',
      );
      expect(mockChatStream).toHaveBeenCalledOnce();
      expect(mockChatStream).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ role: 'user' }),
        ]),
        expect.stringContaining('Docker infrastructure analyst'),
        expect.any(Function),
      );
    });

    it('returns null on LLM failure', async () => {
      mockChatStream.mockRejectedValue(new Error('Ollama connection refused'));

      const insight = makeInsight();
      const result = await explainAnomaly(insight, 'Current cpu: 95.0%');

      expect(result).toBeNull();
    });

    it('returns null on empty response', async () => {
      mockChatStream.mockImplementation(
        async (_msgs: unknown, _sys: unknown, _onChunk: unknown) => '',
      );

      const insight = makeInsight();
      const result = await explainAnomaly(insight, 'Current cpu: 95.0%');

      expect(result).toBeNull();
    });

    it('truncates explanation to 500 chars', async () => {
      const longText = 'x'.repeat(600);
      mockChatStream.mockImplementation(
        async (_msgs: unknown, _sys: unknown, onChunk: (c: string) => void) => {
          onChunk(longText);
          return '';
        },
      );

      const insight = makeInsight();
      const result = await explainAnomaly(insight, 'Current cpu: 95.0%');

      expect(result).toHaveLength(500);
    });
  });

  describe('explainAnomalies', () => {
    it('respects maxExplanations limit', async () => {
      mockChatStream.mockImplementation(
        async (_msgs: unknown, _sys: unknown, onChunk: (c: string) => void) => {
          onChunk('Explanation text');
          return '';
        },
      );

      const anomalies = [
        { insight: makeInsight({ id: 'a1' }), description: 'desc 1' },
        { insight: makeInsight({ id: 'a2' }), description: 'desc 2' },
        { insight: makeInsight({ id: 'a3' }), description: 'desc 3' },
      ];

      const result = await explainAnomalies(anomalies, 2);

      expect(result.size).toBe(2);
      expect(mockChatStream).toHaveBeenCalledTimes(2);
    });

    it('prioritizes critical over warning', async () => {
      const callOrder: string[] = [];
      mockChatStream.mockImplementation(
        async (msgs: Array<{ content: string }>, _sys: unknown, onChunk: (c: string) => void) => {
          const content = msgs[0]?.content ?? '';
          if (content.includes('critical-container')) callOrder.push('critical');
          if (content.includes('warning-container')) callOrder.push('warning');
          onChunk('Explanation');
          return '';
        },
      );

      const anomalies = [
        {
          insight: makeInsight({ id: 'w1', severity: 'warning', container_name: 'warning-container' }),
          description: 'desc',
        },
        {
          insight: makeInsight({ id: 'c1', severity: 'critical', container_name: 'critical-container' }),
          description: 'desc',
        },
      ];

      await explainAnomalies(anomalies, 2);

      expect(callOrder[0]).toBe('critical');
      expect(callOrder[1]).toBe('warning');
    });

    it('skips failed explanations but continues', async () => {
      let callCount = 0;
      mockChatStream.mockImplementation(
        async (_msgs: unknown, _sys: unknown, onChunk: (c: string) => void) => {
          callCount++;
          if (callCount === 1) throw new Error('LLM error');
          onChunk('Working explanation');
          return '';
        },
      );

      const anomalies = [
        { insight: makeInsight({ id: 'a1' }), description: 'desc 1' },
        { insight: makeInsight({ id: 'a2' }), description: 'desc 2' },
      ];

      const result = await explainAnomalies(anomalies, 2);

      expect(result.size).toBe(1);
      expect(result.has('a2')).toBe(true);
    });
  });
});
