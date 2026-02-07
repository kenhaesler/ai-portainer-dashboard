import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockInsertAction = vi.fn();
const mockGetAction = vi.fn();
const mockUpdateActionStatus = vi.fn();
const mockHasPendingAction = vi.fn().mockReturnValue(false);
const mockRestart = vi.fn();
const mockStart = vi.fn();
const mockStop = vi.fn();
const mockBroadcastNewAction = vi.fn();

vi.mock('uuid', () => ({
  v4: () => 'action-123',
}));

vi.mock('./actions-store.js', () => ({
  insertAction: (...args: unknown[]) => mockInsertAction(...args),
  getAction: (...args: unknown[]) => mockGetAction(...args),
  updateActionStatus: (...args: unknown[]) => mockUpdateActionStatus(...args),
  hasPendingAction: (...args: unknown[]) => mockHasPendingAction(...args),
}));

vi.mock('./portainer-client.js', () => ({
  restartContainer: (...args: unknown[]) => mockRestart(...args),
  startContainer: (...args: unknown[]) => mockStart(...args),
  stopContainer: (...args: unknown[]) => mockStop(...args),
}));

vi.mock('./event-bus.js', () => ({
  emitEvent: vi.fn(),
}));

vi.mock('../sockets/remediation.js', () => ({
  broadcastNewAction: (...args: unknown[]) => mockBroadcastNewAction(...args),
}));

import { suggestAction, executeAction } from './remediation-service.js';

describe('remediation-service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it('executes START_CONTAINER action path', async () => {
    mockGetAction.mockReturnValue({
      id: 'action-1',
      endpoint_id: 1,
      container_id: 'c1',
      action_type: 'START_CONTAINER',
      status: 'approved',
    });
    mockUpdateActionStatus.mockReturnValue(true);

    const ok = await executeAction('action-1');
    expect(ok).toBe(true);
    expect(mockStart).toHaveBeenCalledWith(1, 'c1');
  });
});
