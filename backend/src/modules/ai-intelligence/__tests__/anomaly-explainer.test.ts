import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { InsightInsert } from '../services/insights-store.js';

// Kept: prompt template mock — avoids DB lookup for prompt store
vi.mock('../services/prompt-store.js', () => ({
  getEffectivePrompt: vi.fn().mockReturnValue('You are a test assistant.'),
}));

import * as llmClient from '../services/llm-client.js';

const { explainAnomaly, explainAnomalies } = await import('../services/anomaly-explainer.js');

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
      vi.spyOn(llmClient, 'chatStream').mockImplementation(
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
      expect(llmClient.chatStream).toHaveBeenCalledOnce();
      expect(llmClient.chatStream).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ role: 'user' }),
        ]),
        expect.any(String),
        expect.any(Function),
      );
    });

    it('returns null on LLM failure', async () => {
      vi.spyOn(llmClient, 'chatStream').mockRejectedValue(new Error('Ollama connection refused'));

      const insight = makeInsight();
      const result = await explainAnomaly(insight, 'Current cpu: 95.0%');

      expect(result).toBeNull();
    });

    it('returns null on empty response', async () => {
      vi.spyOn(llmClient, 'chatStream').mockImplementation(
        async (_msgs: unknown, _sys: unknown, _onChunk: unknown) => '',
      );

      const insight = makeInsight();
      const result = await explainAnomaly(insight, 'Current cpu: 95.0%');

      expect(result).toBeNull();
    });

    it('truncates explanation to 500 chars', async () => {
      const longText = 'x'.repeat(600);
      vi.spyOn(llmClient, 'chatStream').mockImplementation(
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
    it('uses single call for 1 anomaly', async () => {
      vi.spyOn(llmClient, 'chatStream').mockImplementation(
        async (_msgs: unknown, _sys: unknown, onChunk: (c: string) => void) => {
          onChunk('Single explanation');
          return '';
        },
      );

      const anomalies = [
        { insight: makeInsight({ id: 'a1' }), description: 'desc 1' },
      ];

      const result = await explainAnomalies(anomalies, 5);

      expect(result.size).toBe(1);
      expect(result.get('a1')).toBe('Single explanation');
      expect(llmClient.chatStream).toHaveBeenCalledOnce();
    });

    it('batches multiple anomalies into one LLM call', async () => {
      vi.spyOn(llmClient, 'chatStream').mockImplementation(
        async (_msgs: unknown, _sys: unknown, onChunk: (c: string) => void) => {
          onChunk('[1] CPU spike from a runaway process.\n[2] Memory leak detected.\n[3] Disk IO contention.');
          return '';
        },
      );

      const anomalies = [
        { insight: makeInsight({ id: 'a1' }), description: 'desc 1' },
        { insight: makeInsight({ id: 'a2' }), description: 'desc 2' },
        { insight: makeInsight({ id: 'a3' }), description: 'desc 3' },
      ];

      const result = await explainAnomalies(anomalies, 5);

      expect(llmClient.chatStream).toHaveBeenCalledOnce();
      expect(result.size).toBe(3);
      expect(result.get('a1')).toBe('CPU spike from a runaway process.');
      expect(result.get('a2')).toBe('Memory leak detected.');
      expect(result.get('a3')).toBe('Disk IO contention.');
    });

    it('respects maxExplanations limit', async () => {
      vi.spyOn(llmClient, 'chatStream').mockImplementation(
        async (_msgs: unknown, _sys: unknown, onChunk: (c: string) => void) => {
          onChunk('[1] Explanation one.\n[2] Explanation two.');
          return '';
        },
      );

      const anomalies = [
        { insight: makeInsight({ id: 'a1' }), description: 'desc 1' },
        { insight: makeInsight({ id: 'a2' }), description: 'desc 2' },
        { insight: makeInsight({ id: 'a3' }), description: 'desc 3' },
      ];

      const result = await explainAnomalies(anomalies, 2);

      expect(llmClient.chatStream).toHaveBeenCalledOnce();
      expect(result.size).toBe(2);
    });

    it('prioritizes critical over warning in batch', async () => {
      vi.spyOn(llmClient, 'chatStream').mockImplementation(
        async (msgs: Array<{ content: string }>, _sys: unknown, onChunk: (c: string) => void) => {
          const content = msgs[0]?.content ?? '';
          const criticalIdx = content.indexOf('critical-container');
          const warningIdx = content.indexOf('warning-container');
          expect(criticalIdx).toBeLessThan(warningIdx);
          onChunk('[1] Critical explanation.\n[2] Warning explanation.');
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

      const result = await explainAnomalies(anomalies, 5);

      expect(result.size).toBe(2);
    });

    it('falls back to individual calls when batch parsing fails partially', async () => {
      let callCount = 0;
      vi.spyOn(llmClient, 'chatStream').mockImplementation(
        async (_msgs: unknown, _sys: unknown, onChunk: (c: string) => void) => {
          callCount++;
          if (callCount === 1) {
            onChunk('[1] First explanation.');
            return '';
          }
          onChunk('Fallback explanation for second.');
          return '';
        },
      );

      const anomalies = [
        { insight: makeInsight({ id: 'a1' }), description: 'desc 1' },
        { insight: makeInsight({ id: 'a2' }), description: 'desc 2' },
      ];

      const result = await explainAnomalies(anomalies, 5);

      expect(llmClient.chatStream).toHaveBeenCalledTimes(2);
      expect(result.size).toBe(2);
      expect(result.get('a1')).toBe('First explanation.');
      expect(result.get('a2')).toBe('Fallback explanation for second.');
    });

    it('falls back entirely to individual calls when batch fails', async () => {
      let callCount = 0;
      vi.spyOn(llmClient, 'chatStream').mockImplementation(
        async (_msgs: unknown, _sys: unknown, onChunk: (c: string) => void) => {
          callCount++;
          if (callCount === 1) throw new Error('Batch LLM error');
          onChunk('Individual explanation');
          return '';
        },
      );

      const anomalies = [
        { insight: makeInsight({ id: 'a1' }), description: 'desc 1' },
        { insight: makeInsight({ id: 'a2' }), description: 'desc 2' },
      ];

      const result = await explainAnomalies(anomalies, 5);

      expect(llmClient.chatStream).toHaveBeenCalledTimes(3);
      expect(result.size).toBe(2);
    });

    it('returns empty map for empty input', async () => {
      const chatSpy = vi.spyOn(llmClient, 'chatStream');
      const result = await explainAnomalies([], 5);
      expect(result.size).toBe(0);
      expect(chatSpy).not.toHaveBeenCalled();
    });
  });
});
