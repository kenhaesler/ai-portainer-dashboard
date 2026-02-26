import { beforeAll, afterAll, describe, it, expect, vi, beforeEach } from 'vitest';

const mockInsertAction = vi.fn();
const mockGetAction = vi.fn();
const mockUpdateActionStatus = vi.fn();
const mockUpdateActionRationale = vi.fn();
const mockHasPendingAction = vi.fn().mockReturnValue(false);
const mockBroadcastNewAction = vi.fn();
const mockBroadcastActionUpdate = vi.fn();
const mockGetLatestMetrics = vi.fn();

vi.mock('uuid', () => ({
  v4: () => 'action-123',
}));

// Kept: actions-store mock — tests control action persistence
vi.mock('../services/actions-store.js', () => ({
  insertAction: (...args: unknown[]) => mockInsertAction(...args),
  getAction: (...args: unknown[]) => mockGetAction(...args),
  updateActionStatus: (...args: unknown[]) => mockUpdateActionStatus(...args),
  updateActionRationale: (...args: unknown[]) => mockUpdateActionRationale(...args),
  hasPendingAction: (...args: unknown[]) => mockHasPendingAction(...args),
}));

// Kept: event-bus mock — tests control event emission
vi.mock('../../../core/services/event-bus.js', () => ({
  emitEvent: vi.fn(),
}));

// Kept: metrics-store mock — tests control metrics responses (now in modules/observability)
vi.mock('../../../modules/observability/services/metrics-store.js', () => ({
  getLatestMetrics: (...args: unknown[]) => mockGetLatestMetrics(...args),
}));

// Kept: remediation socket mock — tests control broadcast
vi.mock('../sockets/remediation.js', () => ({
  broadcastNewAction: (...args: unknown[]) => mockBroadcastNewAction(...args),
  broadcastActionUpdate: (...args: unknown[]) => mockBroadcastActionUpdate(...args),
}));

// Kept: prompt-store mock — avoids DB lookup for prompt store
vi.mock('../../ai-intelligence/services/prompt-store.js', () => ({
  getEffectivePrompt: vi.fn().mockResolvedValue('You are a test assistant.'),
}));

import {
  suggestAction,
  parseRemediationAnalysis,
  buildRemediationPrompt,
  isProtectedContainer,
} from '../services/remediation-service.js';
import * as portainerClient from '../../../core/portainer/portainer-client.js';
import * as llmClient from '../../ai-intelligence/services/llm-client.js';
import { cache } from '../../../core/portainer/portainer-cache.js';
import { closeTestRedis } from '../../../test-utils/test-redis-helper.js';

let mockGetContainerLogs: any;
let mockIsOllamaAvailable: any;
let mockChatStream: any;

beforeAll(async () => {
  await cache.clear();
});

afterAll(async () => {
  await closeTestRedis();
});

async function flushMicrotasks() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('remediation-service', () => {
  beforeEach(async () => {
    await cache.clear();
    vi.clearAllMocks();
    vi.restoreAllMocks();
    // Re-set forwarding mock defaults
    mockInsertAction.mockReturnValue(true);
    mockGetAction.mockReturnValue({
      id: 'action-123',
      status: 'pending',
      rationale: 'fallback',
    });
    mockUpdateActionRationale.mockReturnValue(true);
    mockHasPendingAction.mockReturnValue(false);
    mockGetLatestMetrics.mockResolvedValue({ cpu: 93.1, memory: 88.4 });
    // Re-set prompt-store default
    const { getEffectivePrompt } = await import('../../ai-intelligence/services/prompt-store.js');
    vi.mocked(getEffectivePrompt).mockResolvedValue('You are a test assistant.');
    // Portainer + LLM spies
    mockGetContainerLogs = vi.spyOn(portainerClient, 'getContainerLogs').mockResolvedValue('line 1\nline 2');
    mockIsOllamaAvailable = vi.spyOn(llmClient, 'isOllamaAvailable').mockResolvedValue(false);
    mockChatStream = vi.spyOn(llmClient, 'chatStream').mockResolvedValue('');
  });

  it('maps OOM insights to INVESTIGATE (not STOP_CONTAINER) and broadcasts', async () => {
    const result = await suggestAction({
      id: 'insight-1',
      title: 'OOM detected',
      description: 'out of memory',
      suggested_action: '',
      container_id: 'container-1',
      container_name: 'api',
      endpoint_id: 1,
    } as any);

    expect(result).toEqual({ actionId: 'action-123', actionType: 'INVESTIGATE' });
    expect(mockInsertAction).toHaveBeenCalledWith(expect.objectContaining({ action_type: 'INVESTIGATE' }));
    expect(mockBroadcastNewAction).toHaveBeenCalledTimes(1);
  });

  it('skips duplicate when a pending action already exists for container+type', async () => {
    mockHasPendingAction.mockReturnValue(true);

    const result = await suggestAction({
      id: 'insight-2',
      title: 'OOM detected',
      description: 'out of memory',
      suggested_action: '',
      container_id: 'container-1',
      container_name: 'api',
      endpoint_id: 1,
    } as any);

    expect(result).toBeNull();
    expect(mockInsertAction).not.toHaveBeenCalled();
    expect(mockBroadcastNewAction).not.toHaveBeenCalled();
    expect(mockHasPendingAction).toHaveBeenCalledWith('container-1', 'INVESTIGATE');
  });

  it('creates action when no pending duplicate exists', async () => {
    mockHasPendingAction.mockReturnValue(false);

    const result = await suggestAction({
      id: 'insight-3',
      title: 'Container is unhealthy',
      description: 'health check failing',
      suggested_action: '',
      container_id: 'container-2',
      container_name: 'worker',
      endpoint_id: 1,
    } as any);

    expect(result).toEqual({ actionId: 'action-123', actionType: 'RESTART_CONTAINER' });
    expect(mockHasPendingAction).toHaveBeenCalledWith('container-2', 'RESTART_CONTAINER');
    expect(mockInsertAction).toHaveBeenCalledTimes(1);
  });

  it('does not broadcast when insert is rejected by unique constraint', async () => {
    mockHasPendingAction.mockReturnValue(false);
    mockInsertAction.mockReturnValue(false);

    const result = await suggestAction({
      id: 'insight-5',
      title: 'OOM detected',
      description: 'out of memory',
      suggested_action: '',
      container_id: 'container-3',
      container_name: 'worker',
      endpoint_id: 1,
    } as any);

    expect(result).toBeNull();
    expect(mockInsertAction).toHaveBeenCalledTimes(1);
    expect(mockBroadcastNewAction).not.toHaveBeenCalled();
  });

  it('maps high CPU to INVESTIGATE (not STOP_CONTAINER)', async () => {
    mockHasPendingAction.mockReturnValue(false);

    const result = await suggestAction({
      id: 'insight-4',
      title: 'high cpu spike',
      description: 'runaway process',
      suggested_action: '',
      container_id: 'container-1',
      container_name: 'api',
      endpoint_id: 1,
    } as any);

    expect(result).not.toBeNull();
    expect(result!.actionType).toBe('INVESTIGATE');
    expect(mockHasPendingAction).toHaveBeenCalledWith('container-1', 'INVESTIGATE');
  });

  it('enriches rationale with structured LLM analysis when available', async () => {
    mockIsOllamaAvailable.mockResolvedValue(true);
    mockChatStream.mockImplementation(async (_messages: any, _system: any, onChunk: any) => {
      onChunk(JSON.stringify({
        root_cause: 'OOM due to connection pool leak',
        severity: 'critical',
        recommended_actions: [
          {
            action: 'Restart the container',
            priority: 'high',
            rationale: 'Recovers service quickly while leak is investigated',
          },
        ],
        log_analysis: 'Repeated pool exhaustion warnings before malloc failure',
        confidence_score: 0.82,
      }));
      return '';
    });

    const result = await suggestAction({
      id: 'insight-6',
      title: 'OOM detected',
      description: 'out of memory',
      suggested_action: '',
      container_id: 'container-4',
      container_name: 'api',
      endpoint_id: 1,
    } as any);

    expect(result).toEqual({ actionId: 'action-123', actionType: 'INVESTIGATE' });

    await flushMicrotasks();

    expect(mockGetContainerLogs).toHaveBeenCalledWith(1, 'container-4', { tail: 50, timestamps: true });
    expect(mockGetLatestMetrics).toHaveBeenCalledWith('container-4');
    expect(mockUpdateActionRationale).toHaveBeenCalledTimes(1);
    const stored = mockUpdateActionRationale.mock.calls[0]?.[1];
    expect(typeof stored).toBe('string');
    expect(String(stored)).toContain('OOM due to connection pool leak');
    expect(mockBroadcastActionUpdate).toHaveBeenCalledTimes(1);
  });

  it('retries with stricter prompt when first LLM attempt returns unstructured output (#746)', async () => {
    mockIsOllamaAvailable.mockResolvedValue(true);
    let callCount = 0;
    mockChatStream.mockImplementation(async (_messages: any, _system: any, onChunk: any) => {
      callCount++;
      if (callCount === 1) {
        // First attempt: unstructured
        onChunk('container looks unhealthy, maybe restart');
      } else {
        // Retry: structured JSON
        onChunk(JSON.stringify({
          root_cause: 'Health check timeout due to slow startup',
          severity: 'warning',
          recommended_actions: [
            { action: 'Increase health check timeout', priority: 'medium', rationale: 'Startup takes 30s' },
          ],
          log_analysis: 'Health check probe fails during startup',
          confidence_score: 0.75,
        }));
      }
      return '';
    });

    const result = await suggestAction({
      id: 'insight-retry',
      title: 'Container unhealthy',
      description: 'health check failing',
      suggested_action: '',
      container_id: 'container-retry',
      container_name: 'api',
      endpoint_id: 1,
    } as any);

    expect(result).toEqual({ actionId: 'action-123', actionType: 'RESTART_CONTAINER' });

    await flushMicrotasks();

    // chatStream should have been called twice (original + retry)
    expect(mockChatStream).toHaveBeenCalledTimes(2);
    // Retry should include the original response as assistant message
    const retryCall = mockChatStream.mock.calls[1];
    const retryMessages = retryCall[0] as Array<{ role: string; content: string }>;
    expect(retryMessages.some((m: any) => m.role === 'assistant')).toBe(true);
    expect(retryMessages.some((m: any) => m.content.includes('not valid JSON'))).toBe(true);

    // Should have updated rationale with the structured response
    expect(mockUpdateActionRationale).toHaveBeenCalledTimes(1);
    const stored = mockUpdateActionRationale.mock.calls[0]?.[1];
    expect(String(stored)).toContain('Health check timeout');
    expect(mockBroadcastActionUpdate).toHaveBeenCalledTimes(1);
  });

  it('gives up after retry also returns unstructured output (#746)', async () => {
    mockIsOllamaAvailable.mockResolvedValue(true);
    mockChatStream.mockImplementation(async (_messages: any, _system: any, onChunk: any) => {
      // Both attempts return unstructured output
      onChunk('I think the container needs attention');
      return '';
    });

    const result = await suggestAction({
      id: 'insight-giveup',
      title: 'Container unhealthy',
      description: 'health check failing',
      suggested_action: '',
      container_id: 'container-giveup',
      container_name: 'api',
      endpoint_id: 1,
    } as any);

    expect(result).toEqual({ actionId: 'action-123', actionType: 'RESTART_CONTAINER' });

    await flushMicrotasks();

    // chatStream called twice (original + retry)
    expect(mockChatStream).toHaveBeenCalledTimes(2);
    // But neither produced parseable JSON, so no rationale update
    expect(mockUpdateActionRationale).not.toHaveBeenCalled();
    expect(mockBroadcastActionUpdate).not.toHaveBeenCalled();
  });

  it('keeps fallback rationale when LLM output is unstructured (both attempts fail)', async () => {
    mockIsOllamaAvailable.mockResolvedValue(true);
    mockChatStream.mockImplementation(async (_messages: any, _system: any, onChunk: any) => {
      onChunk('container looks unhealthy, maybe restart');
      return '';
    });

    const result = await suggestAction({
      id: 'insight-7',
      title: 'Container unhealthy',
      description: 'health check failing',
      suggested_action: '',
      container_id: 'container-7',
      container_name: 'api',
      endpoint_id: 1,
    } as any);

    expect(result).toEqual({ actionId: 'action-123', actionType: 'RESTART_CONTAINER' });

    await flushMicrotasks();

    expect(mockGetContainerLogs).toHaveBeenCalledWith(1, 'container-7', { tail: 50, timestamps: true });
    expect(mockGetLatestMetrics).toHaveBeenCalledWith('container-7');
    // Both attempts return unstructured output, so no rationale update
    expect(mockUpdateActionRationale).not.toHaveBeenCalled();
    expect(mockBroadcastActionUpdate).not.toHaveBeenCalled();
  });
});

describe('isProtectedContainer', () => {
  it('identifies portainer as protected', () => {
    expect(isProtectedContainer('portainer')).toBe(true);
  });

  it('identifies portainer-agent variant as protected', () => {
    expect(isProtectedContainer('portainer-agent')).toBe(true);
  });

  it('identifies redis as protected', () => {
    expect(isProtectedContainer('redis')).toBe(true);
  });

  it('identifies postgres as protected', () => {
    expect(isProtectedContainer('postgres')).toBe(true);
  });

  it('identifies traefik as protected', () => {
    expect(isProtectedContainer('traefik')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isProtectedContainer('Portainer')).toBe(true);
    expect(isProtectedContainer('REDIS')).toBe(true);
  });

  it('does not flag regular app containers', () => {
    expect(isProtectedContainer('my-web-app')).toBe(false);
    expect(isProtectedContainer('api-server')).toBe(false);
    expect(isProtectedContainer('worker')).toBe(false);
  });
});

describe('protected container safety', () => {
  beforeEach(async () => {
    await cache.clear();
    vi.clearAllMocks();
    vi.restoreAllMocks();
    // Re-set forwarding mock defaults
    mockInsertAction.mockReturnValue(true);
    mockHasPendingAction.mockReturnValue(false);
    // Re-set prompt-store default
    const { getEffectivePrompt } = await import('../../ai-intelligence/services/prompt-store.js');
    vi.mocked(getEffectivePrompt).mockResolvedValue('You are a test assistant.');
    // Portainer + LLM spies
    mockGetContainerLogs = vi.spyOn(portainerClient, 'getContainerLogs').mockResolvedValue('line 1\nline 2');
    mockIsOllamaAvailable = vi.spyOn(llmClient, 'isOllamaAvailable').mockResolvedValue(false);
    mockChatStream = vi.spyOn(llmClient, 'chatStream').mockResolvedValue('');
  });

  it('never suggests STOP_CONTAINER — OOM maps to INVESTIGATE', async () => {
    const result = await suggestAction({
      id: 'insight-oom',
      title: 'OOM detected',
      description: 'Container hit memory limit (OOM)',
      suggested_action: '',
      container_id: 'container-portainer',
      container_name: 'portainer',
      endpoint_id: 1,
    } as any);

    expect(result).not.toBeNull();
    expect(result!.actionType).toBe('INVESTIGATE');
    expect(result!.actionType).not.toBe('STOP_CONTAINER');
  });

  it('downgrades RESTART_CONTAINER to INVESTIGATE for protected containers', async () => {
    const result = await suggestAction({
      id: 'insight-unhealthy-redis',
      title: 'Container is unhealthy',
      description: 'health check failing on redis',
      suggested_action: '',
      container_id: 'container-redis',
      container_name: 'redis',
      endpoint_id: 1,
    } as any);

    expect(result).not.toBeNull();
    expect(result!.actionType).toBe('INVESTIGATE');
  });

  it('allows RESTART_CONTAINER for non-protected containers', async () => {
    const result = await suggestAction({
      id: 'insight-unhealthy-app',
      title: 'Container is unhealthy',
      description: 'health check failing on my-app',
      suggested_action: '',
      container_id: 'container-app',
      container_name: 'my-app',
      endpoint_id: 1,
    } as any);

    expect(result).not.toBeNull();
    expect(result!.actionType).toBe('RESTART_CONTAINER');
  });

  it('allows START_CONTAINER for protected containers (non-destructive)', async () => {
    const result = await suggestAction({
      id: 'insight-stopped-portainer',
      title: 'Container stopped',
      description: 'Container is not running',
      suggested_action: '',
      container_id: 'container-portainer',
      container_name: 'portainer',
      endpoint_id: 1,
    } as any);

    expect(result).not.toBeNull();
    expect(result!.actionType).toBe('START_CONTAINER');
  });

  it('blocks destructive actions on portainer-agent variant', async () => {
    const result = await suggestAction({
      id: 'insight-agent',
      title: 'Container is unhealthy',
      description: 'health check failing',
      suggested_action: '',
      container_id: 'container-agent',
      container_name: 'portainer-agent',
      endpoint_id: 1,
    } as any);

    expect(result).not.toBeNull();
    expect(result!.actionType).toBe('INVESTIGATE');
  });

  it('reproduces issue #450 scenario: certificate error should not suggest Stop Container', async () => {
    // Simulates the cascade: cert error → false memory anomaly → suggested_action with "memory" keywords
    const result = await suggestAction({
      id: 'insight-450',
      title: 'Anomalous memory usage on "portainer"',
      description: 'Current memory: 45.2% (mean: 42.1%, z-score: 3.10). This is 3.1 standard deviations from the moving average.',
      suggested_action: 'Investigate memory usage patterns and check container configuration',
      container_id: 'container-portainer',
      container_name: 'portainer',
      endpoint_id: 1,
    } as any);

    // Should NEVER suggest STOP_CONTAINER for portainer
    if (result) {
      expect(result.actionType).not.toBe('STOP_CONTAINER');
      expect(result.actionType).toBe('INVESTIGATE');
    }
  });
});

describe('parseRemediationAnalysis', () => {
  it('parses fenced json payload', () => {
    const result = parseRemediationAnalysis('```json\n{"root_cause":"a","severity":"info","recommended_actions":[],"log_analysis":"","confidence_score":0.9}\n```');
    expect(result.root_cause).toBe('a');
    expect(result.severity).toBe('info');
    expect(result.confidence_score).toBe(0.9);
  });

  it('falls back to raw text when response is not json', () => {
    const result = parseRemediationAnalysis('unstructured llm response');
    expect(result.root_cause).toContain('unstructured');
    expect(result.recommended_actions).toHaveLength(0);
  });
});

describe('buildRemediationPrompt', () => {
  it('includes insight context, metrics, and logs', () => {
    const prompt = buildRemediationPrompt({
      id: 'insight-1',
      title: 'High memory',
      description: 'memory climbing',
      severity: 'warning',
      container_id: 'container-1',
      container_name: 'api',
      endpoint_id: 1,
      endpoint_name: 'prod',
      suggested_action: 'restart',
    } as any, {
      logs: 'warn: pool exhausted',
      metrics: { cpu: 90.1, memory: 95.2 },
    });

    expect(prompt).toContain('High memory');
    expect(prompt).toContain('cpu: 90.10');
    expect(prompt).toContain('warn: pool exhausted');
    expect(prompt).toContain('"root_cause"');
  });

  it('includes observer-first constraints prohibiting destructive actions', () => {
    const prompt = buildRemediationPrompt({
      id: 'insight-1',
      title: 'Test',
      description: 'test',
      severity: 'warning',
      container_id: 'c1',
      container_name: 'api',
      endpoint_id: 1,
      endpoint_name: 'prod',
      suggested_action: null,
    } as any, {});

    expect(prompt).toContain('NEVER recommend stopping or restarting containers');
    expect(prompt).toContain('observer-first');
  });
});
