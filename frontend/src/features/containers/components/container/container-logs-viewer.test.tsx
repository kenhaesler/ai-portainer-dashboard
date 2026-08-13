import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UserRole } from '@/providers/auth-provider';

const mockCollect = vi.fn();
const mockReset = vi.fn();

vi.mock('@/features/operations/hooks/use-edge-async-logs', () => ({
  useEdgeAsyncLogs: () => ({
    status: 'idle',
    logs: null,
    durationMs: null,
    error: null,
    collect: mockCollect,
    reset: mockReset,
  }),
}));

let mockRole: UserRole = 'admin';
vi.mock('@/providers/auth-provider', () => ({
  useAuth: () => ({ role: mockRole }),
}));

import { ContainerLogsViewer } from './container-logs-viewer';

function renderEdgeAsyncLogs() {
  return render(
    <ContainerLogsViewer endpointId={7} containerId="abc123" isEdgeAsync />,
  );
}

describe('ContainerLogsViewer Edge Async role gating', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRole = 'admin';
  });

  it.each<UserRole>(['viewer', 'operator'])(
    'shows a read-only explanation instead of job controls for %s users',
    (role) => {
      mockRole = role;
      renderEdgeAsyncLogs();

      expect(screen.getByText('Administrator access required')).toBeInTheDocument();
      expect(screen.getByText(/creates and removes a Portainer Edge Job/i)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /collect logs|retry|re-collect/i })).not.toBeInTheDocument();
      expect(mockCollect).not.toHaveBeenCalled();
    },
  );

  it('allows an administrator to initiate collection', () => {
    renderEdgeAsyncLogs();

    fireEvent.click(screen.getByRole('button', { name: 'Collect Logs' }));

    expect(mockCollect).toHaveBeenCalledWith({ tail: 100 });
  });
});
