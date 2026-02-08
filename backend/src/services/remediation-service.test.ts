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

import {
  suggestAction,
  parseRemediationAnalysis,
  buildRemediationPrompt,
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

  it('maps OOM insights to STOP_CONTAINER and broadcasts', () => {
    const result = suggestAction({
      id: 'insight-1',
      title: 'OOM detected',
      description: 'out of memory',
      suggested_action: '',
      container_id: 'container-1',
      container_name: 'api',
      endpoint_id: 1,
    } as any);

    expect(result).toEqual({ actionId: 'action-123', actionType: 'STOP_CONTAINER' });
    expect(mockInsertAction).toHaveBeenCalledWith(expect.objectContaining({ action_type: 'STOP_CONTAINER' }));
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
    expect(mockHasPendingAction).toHaveBeenCalledWith('container-1', 'STOP_CONTAINER');
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

  it('allows different action types for same container', () => {
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
    expect(mockHasPendingAction).toHaveBeenCalledWith('container-1', 'STOP_CONTAINER');
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

    expect(result).toEqual({ actionId: 'action-123', actionType: 'STOP_CONTAINER' });

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
});
