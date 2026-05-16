import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const mockCreate = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();
const mockTest = vi.fn();
const mockRefetch = vi.fn();

const { useWebhooksMock } = vi.hoisted(() => ({ useWebhooksMock: vi.fn() }));

const defaultWebhook = {
  id: 'wh-1',
  name: 'Alerts Hook',
  url: 'https://hooks.example.com/alerts',
  secret: 'abcd1234...',
  events: ['insight.created'],
  enabled: 1,
  description: null,
  created_at: '2026-02-06T10:00:00Z',
  updated_at: '2026-02-06T10:00:00Z',
};

vi.mock('@/features/core/hooks/use-webhooks', () => ({
  useWebhooks: useWebhooksMock,
  useWebhookEventTypes: () => ({
    data: [
      { type: '*', description: 'All events' },
      { type: 'insight.created', description: 'New insight created' },
    ],
  }),
  useWebhookDeliveries: () => ({
    data: {
      deliveries: [
        {
          id: 'd-1',
          webhook_id: 'wh-1',
          event_type: 'insight.created',
          payload: '{}',
          status: 'delivered',
          http_status: 200,
          response_body: null,
          attempt: 1,
          max_attempts: 5,
          next_retry_at: null,
          delivered_at: '2026-02-06T10:01:00Z',
          created_at: '2026-02-06T10:01:00Z',
        },
      ],
      total: 1,
    },
    isLoading: false,
  }),
  useCreateWebhook: () => ({ mutateAsync: (...args: unknown[]) => mockCreate(...args), isPending: false }),
  useUpdateWebhook: () => ({ mutateAsync: (...args: unknown[]) => mockUpdate(...args), isPending: false }),
  useDeleteWebhook: () => ({ mutateAsync: (...args: unknown[]) => mockDelete(...args), isPending: false }),
  useTestWebhook: () => ({ mutateAsync: (...args: unknown[]) => mockTest(...args), isPending: false }),
  streamDashboardEvents: () => Promise.resolve(),
}));

import { WebhooksPanel } from './webhooks';

describe('WebhooksPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useWebhooksMock.mockReturnValue({
      data: [defaultWebhook],
      isLoading: false,
      refetch: mockRefetch,
    });
  });

  it('shows the empty state when no webhooks exist', () => {
    useWebhooksMock.mockReturnValue({ data: [], isLoading: false, refetch: mockRefetch });
    render(<WebhooksPanel />);
    expect(screen.getByText('No webhooks configured yet')).toBeInTheDocument();
    expect(screen.getByTestId('empty-state-card')).toBeInTheDocument();
    expect(screen.queryByText('No webhooks match the current filter.')).not.toBeInTheDocument();
  });

  it('renders webhook list, delivery monitor, and add button', () => {
    render(<WebhooksPanel />);

    expect(screen.getByText('Add Webhook')).toBeInTheDocument();
    expect(screen.getByText('Alerts Hook')).toBeInTheDocument();
    expect(screen.getByText('Delivery Monitor')).toBeInTheDocument();
    expect(screen.getAllByText('insight.created').length).toBeGreaterThan(0);
  });

  it('creates a webhook from form input', async () => {
    render(<WebhooksPanel />);

    fireEvent.change(screen.getByPlaceholderText('alerts-slack'), { target: { value: 'PagerDuty Hook' } });
    fireEvent.change(screen.getByPlaceholderText('https://hooks.example.com/...'), { target: { value: 'https://events.pagerduty.com/v2/enqueue' } });

    fireEvent.click(screen.getByRole('button', { name: /create/i }));

    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
        name: 'PagerDuty Hook',
        url: 'https://events.pagerduty.com/v2/enqueue',
      }));
    });
  });

  it('tests and deletes a webhook via actions', async () => {
    render(<WebhooksPanel />);

    fireEvent.click(screen.getByRole('button', { name: /test/i }));

    await waitFor(() => {
      expect(mockTest).toHaveBeenCalledWith('wh-1');
    });

    // Click Delete button to open the confirm dialog, then confirm
    fireEvent.click(screen.getByRole('button', { name: /delete/i }));
    await waitFor(() => {
      expect(screen.getByText('Delete Webhook')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(mockDelete).toHaveBeenCalledWith('wh-1');
    });
  });
});
