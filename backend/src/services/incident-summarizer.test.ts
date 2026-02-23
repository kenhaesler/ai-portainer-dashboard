import { describe, it, expect, vi, beforeEach } from 'vitest';

// Kept: prompt template mock — avoids DB lookup for prompt store
vi.mock('./prompt-store.js', () => ({
  getEffectivePrompt: vi.fn().mockReturnValue('You are a test assistant.'),
}));

import * as llmClient from './llm-client.js';
import { generateLlmIncidentSummary } from './incident-summarizer.js';
import type { Insight } from '../models/monitoring.js';

function makeInsight(overrides: Partial<Insight> = {}): Insight {
  return {
    id: 'test-id',
    endpoint_id: 1,
    endpoint_name: 'test-endpoint',
    container_id: 'container-1',
    container_name: 'test-container',
    severity: 'warning',
    category: 'anomaly',
    title: 'Test insight',
    description: 'Test description of the anomaly',
    suggested_action: null,
    is_acknowledged: 0,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('incident-summarizer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns summary when LLM available', async () => {
    vi.spyOn(llmClient, 'chatStream').mockImplementation((_msgs: unknown, _sys: unknown, onChunk: (s: string) => void) => {
      onChunk('Multiple containers are experiencing high CPU usage, suggesting a shared infrastructure bottleneck affecting the web tier.');
      return Promise.resolve('');
    });

    const insights = [
      makeInsight({ id: '1', title: 'High CPU on web-app' }),
      makeInsight({ id: '2', title: 'High CPU on api-server' }),
    ];

    const result = await generateLlmIncidentSummary(insights, 'cascade');
    expect(result).not.toBeNull();
    expect(result!.length).toBeGreaterThan(0);
    expect(result!.length).toBeLessThanOrEqual(500);
  });

  it('returns null on LLM failure', async () => {
    vi.spyOn(llmClient, 'chatStream').mockRejectedValue(new Error('LLM unavailable'));

    const insights = [
      makeInsight({ id: '1' }),
      makeInsight({ id: '2' }),
    ];

    const result = await generateLlmIncidentSummary(insights, 'cascade');
    expect(result).toBeNull();
  });

  it('returns null for fewer than 2 insights', async () => {
    const chatSpy = vi.spyOn(llmClient, 'chatStream');
    const result = await generateLlmIncidentSummary([makeInsight()], 'cascade');
    expect(result).toBeNull();
    expect(chatSpy).not.toHaveBeenCalled();
  });

  it('respects character limit', async () => {
    vi.spyOn(llmClient, 'chatStream').mockImplementation((_msgs: unknown, _sys: unknown, onChunk: (s: string) => void) => {
      onChunk('A'.repeat(1000));
      return Promise.resolve('');
    });

    const insights = [
      makeInsight({ id: '1' }),
      makeInsight({ id: '2' }),
    ];

    const result = await generateLlmIncidentSummary(insights, 'cascade');
    expect(result).not.toBeNull();
    expect(result!.length).toBeLessThanOrEqual(500);
  });

  it('returns null when LLM returns empty response', async () => {
    vi.spyOn(llmClient, 'chatStream').mockImplementation((_msgs: unknown, _sys: unknown, _onChunk: (s: string) => void) => {
      return Promise.resolve('');
    });

    const insights = [
      makeInsight({ id: '1' }),
      makeInsight({ id: '2' }),
    ];

    const result = await generateLlmIncidentSummary(insights, 'cascade');
    expect(result).toBeNull();
  });
});
