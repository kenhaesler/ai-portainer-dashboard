import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockInsertAction = vi.fn();
const mockGetAction = vi.fn();
const mockUpdateActionStatus = vi.fn();
const mockUpdateActionRationale = vi.fn();
const mockHasPendingAction = vi.fn().mockReturnValue(false);
const mockBroadcastNewAction = vi.fn();
const mockBroadcastActionUpdate = vi.fn();
const mockIsOllamaAvailable = vi.fn();
const mockChatStream = vi.fn();
const mockGetContainerLogs = vi.fn();
const mockGetLatestMetrics = vi.fn();

vi.mock('uuid', () => ({
  v4: () => 'action-123',
}));

vi.mock('./actions-store.js', () => ({
  insertAction: (...args: unknown[]) => mockInsertAction(...args),
  getAction: (...args: unknown[]) => mockGetAction(...args),
  updateActionStatus: (...args: unknown[]) => mockUpdateActionStatus(...args),
  updateActionRationale: (...args: unknown[]) => mockUpdateActionRationale(...args),
  hasPendingAction: (...args: unknown[]) => mockHasPendingAction(...args),
}));

vi.mock('./event-bus.js', () => ({
  emitEvent: vi.fn(),
}));

vi.mock('./portainer-client.js', () => ({
  getContainerLogs: (...args: unknown[]) => mockGetContainerLogs(...args),
}));

vi.mock('./metrics-store.js', () => ({
  getLatestMetrics: (...args: unknown[]) => mockGetLatestMetrics(...args),
}));

vi.mock('./llm-client.js', () => ({
  isOllamaAvailable: (...args: unknown[]) => mockIsOllamaAvailable(...args),
  chatStream: (...args: unknown[]) => mockChatStream(...args),
}));

vi.mock('../sockets/remediation.js', () => ({
  broadcastNewAction: (...args: unknown[]) => mockBroadcastNewAction(...args),
  broadcastActionUpdate: (...args: unknown[]) => mockBroadcastActionUpdate(...args),
}));

vi.mock('./prompt-store.js', () => ({
  getEffectivePrompt: vi.fn().mockReturnValue('You are a test assistant.'),
}));

vi.mock('../config/index.js', () => ({
  getConfig: () => ({}),
}));

import {
  suggestAction,
  parseRemediationAnalysis,
  buildRemediationPrompt,
  isProtectedContainer,
} from './remediation-service.js';

async function flushMicrotasks() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('remediation-service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInsertAction.mockReturnValue(true);
    mockGetAction.mockReturnValue({
      id: 'action-123',
      status: 'pending',
      rationale: 'fallback',
    });
    mockUpdateActionRationale.mockReturnValue(true);
    mockHasPendingAction.mockReturnValue(false);
    mockIsOllamaAvailable.mockResolvedValue(false);
    mockGetContainerLogs.mockResolvedValue('line 1\nline 2');
    mockGetLatestMetrics.mockResolvedValue({ cpu: 93.1, memory: 88.4 });
    mockChatStream.mockResolvedValue('');
  });

  it('maps OOM insights to INVESTIGATE (not STOP_CONTAINER) and broadcasts', () => {
    const result = suggestAction({
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

  it('skips duplicate when a pending action already exists for container+type', () => {
    mockHasPendingAction.mockReturnValue(true);

    const result = suggestAction({
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

  it('creates action when no pending duplicate exists', () => {
    mockHasPendingAction.mockReturnValue(false);

    const result = suggestAction({
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

  it('does not broadcast when insert is rejected by unique constraint', () => {
    mockHasPendingAction.mockReturnValue(false);
    mockInsertAction.mockReturnValue(false);

    const result = suggestAction({
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

  it('maps high CPU to INVESTIGATE (not STOP_CONTAINER)', () => {
    mockHasPendingAction.mockReturnValue(false);

    const result = suggestAction({
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
    mockChatStream.mockImplementation(async (_messages, _system, onChunk) => {
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

    const result = suggestAction({
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

  it('keeps fallback rationale when LLM output is unstructured', async () => {
    mockIsOllamaAvailable.mockResolvedValue(true);
    mockChatStream.mockImplementation(async (_messages, _system, onChunk) => {
      onChunk('container looks unhealthy, maybe restart');
      return '';
    });

    const result = suggestAction({
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
  beforeEach(() => {
    vi.clearAllMocks();
    mockInsertAction.mockReturnValue(true);
    mockHasPendingAction.mockReturnValue(false);
    mockIsOllamaAvailable.mockResolvedValue(false);
  });

  it('never suggests STOP_CONTAINER — OOM maps to INVESTIGATE', () => {
    const result = suggestAction({
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

  it('downgrades RESTART_CONTAINER to INVESTIGATE for protected containers', () => {
    const result = suggestAction({
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

  it('allows RESTART_CONTAINER for non-protected containers', () => {
    const result = suggestAction({
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

  it('allows START_CONTAINER for protected containers (non-destructive)', () => {
    const result = suggestAction({
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

  it('blocks destructive actions on portainer-agent variant', () => {
    const result = suggestAction({
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

  it('reproduces issue #450 scenario: certificate error should not suggest Stop Container', () => {
    // Simulates the cascade: cert error → false memory anomaly → suggested_action with "memory" keywords
    const result = suggestAction({
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
