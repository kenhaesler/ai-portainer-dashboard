import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const mockGet = vi.fn();

vi.mock('@/lib/api', () => ({
  api: {
    get: (...args: unknown[]) => mockGet(...args),
    post: vi.fn(),
    patch: vi.fn(),
  },
}));

import { NotificationHistoryPanel } from './settings';

describe('NotificationHistoryPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockGet.mockResolvedValue({
      entries: [
        {
          id: 1,
          channel: 'teams',
          event_type: 'anomaly_detected',
          title: 'CPU Spike',
          body: 'High CPU observed on api-1',
          severity: 'warning',
          status: 'sent',
          error: null,
          container_name: 'api-1',
          created_at: new Date().toISOString(),
        },
        {
          id: 2,
          channel: 'email',
          event_type: 'incident_summary',
          title: 'Delivery Failure',
          body: 'SMTP connection failed',
          severity: 'critical',
          status: 'failed',
          error: 'SMTP timeout',
          container_name: null,
          created_at: new Date().toISOString(),
        },
      ],
      total: 2,
      limit: 200,
      offset: 0,
    });
  });

  it('loads and renders notification history entries', async () => {
    render(<NotificationHistoryPanel />);

    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith('/api/notifications/history', {
        params: { limit: 200, offset: 0, channel: undefined },
      });
    });

    expect(screen.getByText('CPU Spike')).toBeInTheDocument();
    expect(screen.getByText('Delivery Failure')).toBeInTheDocument();
  });

  it('filters entries by status', async () => {
    render(<NotificationHistoryPanel />);

    await waitFor(() => {
      expect(screen.getByText('CPU Spike')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'failed' } });

    expect(screen.queryByText('CPU Spike')).not.toBeInTheDocument();
    expect(screen.getByText('Delivery Failure')).toBeInTheDocument();
  });

  it('shows error state when history request fails', async () => {
    mockGet.mockRejectedValueOnce(new Error('Request failed'));

    render(<NotificationHistoryPanel />);

    await waitFor(() => {
      expect(screen.getByText('Failed to load notification history')).toBeInTheDocument();
      expect(screen.getByText('Request failed')).toBeInTheDocument();
    });
  });
});
