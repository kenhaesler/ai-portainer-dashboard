import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { NotificationTestButtons, NotificationHistoryPanel } from './tab-monitoring';

// Mock the api module
vi.mock('@/shared/lib/api', () => ({
  api: {
    post: vi.fn(),
    get: vi.fn(),
  },
}));

// Mock sonner toast
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import { api } from '@/shared/lib/api';
import { toast } from 'sonner';

describe('NotificationTestButtons', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render test buttons for all four channels', () => {
    render(<NotificationTestButtons />);

    expect(screen.getByText('Test Teams')).toBeInTheDocument();
    expect(screen.getByText('Test Email')).toBeInTheDocument();
    expect(screen.getByText('Test Discord')).toBeInTheDocument();
    expect(screen.getByText('Test Telegram')).toBeInTheDocument();
  });

  it('should send test notification for Discord', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ success: true });

    render(<NotificationTestButtons />);
    fireEvent.click(screen.getByText('Test Discord'));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/api/notifications/test', { channel: 'discord' });
    });

    expect(toast.success).toHaveBeenCalledWith('Test discord notification sent successfully');
  });

  it('should send test notification for Telegram', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ success: true });

    render(<NotificationTestButtons />);
    fireEvent.click(screen.getByText('Test Telegram'));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/api/notifications/test', { channel: 'telegram' });
    });

    expect(toast.success).toHaveBeenCalledWith('Test telegram notification sent successfully');
  });

  it('should show error toast on Discord test failure', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ success: false, error: 'Discord webhook URL not configured' });

    render(<NotificationTestButtons />);
    fireEvent.click(screen.getByText('Test Discord'));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        'Failed to send test discord notification: Discord webhook URL not configured',
      );
    });
  });

  it('should show error toast on Telegram test failure', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ success: false, error: 'Telegram bot token or chat ID not configured' });

    render(<NotificationTestButtons />);
    fireEvent.click(screen.getByText('Test Telegram'));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        'Failed to send test telegram notification: Telegram bot token or chat ID not configured',
      );
    });
  });

  it('should disable all buttons while a test is in progress', async () => {
    // Create a never-resolving promise to keep loading state
    let resolvePromise!: (value: unknown) => void;
    vi.mocked(api.post).mockReturnValueOnce(new Promise((resolve) => { resolvePromise = resolve; }));

    render(<NotificationTestButtons />);
    fireEvent.click(screen.getByText('Test Discord'));

    // All buttons should be disabled while testing
    const buttons = screen.getAllByRole('button');
    buttons.forEach((btn) => {
      expect(btn).toBeDisabled();
    });

    // Resolve and cleanup
    resolvePromise({ success: true });
  });
});

describe('NotificationHistoryPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const sampleEntries = [
    {
      id: 1,
      channel: 'discord' as const,
      event_type: 'container.health',
      title: 'Container unhealthy',
      body: 'web-1 reported an unhealthy status check',
      severity: 'warning',
      status: 'sent' as const,
      error: null,
      container_name: 'web-1',
      created_at: '2026-05-29T10:00:00.000Z',
    },
    {
      id: 2,
      channel: 'email' as const,
      event_type: 'anomaly.detected',
      title: 'Anomaly detected',
      body: 'CPU spike on api-2',
      severity: 'critical',
      status: 'failed' as const,
      error: 'SMTP connection refused',
      container_name: 'api-2',
      created_at: '2026-05-29T09:30:00.000Z',
    },
  ];

  it('should render the DataTable with notification history rows', { timeout: 15000 }, async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      entries: sampleEntries,
      total: sampleEntries.length,
      limit: 200,
      offset: 0,
    });

    render(<NotificationHistoryPanel />);

    // DataTable mounts once data loads
    await waitFor(() => {
      expect(screen.getByTestId('data-table')).toBeInTheDocument();
    });

    // Headers preserved from the migrated table (scoped to the table —
    // "Channel"/"Status" also appear as filter labels above it)
    const table = within(screen.getByTestId('data-table'));
    expect(table.getByText('Time')).toBeInTheDocument();
    expect(table.getByText('Channel')).toBeInTheDocument();
    expect(table.getByText('Status')).toBeInTheDocument();
    expect(table.getByText('Event')).toBeInTheDocument();
    expect(table.getByText('Message')).toBeInTheDocument();
    expect(table.getByText('Error')).toBeInTheDocument();

    // Cell rendering preserved (titles, statuses, error fallback)
    expect(screen.getByText('Container unhealthy')).toBeInTheDocument();
    expect(screen.getByText('Anomaly detected')).toBeInTheDocument();
    expect(screen.getByText('sent')).toBeInTheDocument();
    expect(screen.getByText('failed')).toBeInTheDocument();
    expect(screen.getByText('SMTP connection refused')).toBeInTheDocument();
  });

  it('should show the empty state when there is no history', { timeout: 15000 }, async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      entries: [],
      total: 0,
      limit: 200,
      offset: 0,
    });

    render(<NotificationHistoryPanel />);

    await waitFor(() => {
      expect(screen.getByText('No notification history found')).toBeInTheDocument();
    });
    // DataTable should not render when there are no entries
    expect(screen.queryByTestId('data-table')).not.toBeInTheDocument();
  });
});

describe('DEFAULT_SETTINGS.notifications', () => {
  it('should include Discord and Telegram settings', async () => {
    const { DEFAULT_SETTINGS } = await import('./shared');

    const keys = DEFAULT_SETTINGS.notifications.map((s) => s.key);

    // Discord settings
    expect(keys).toContain('notifications.discord_enabled');
    expect(keys).toContain('notifications.discord_webhook_url');

    // Telegram settings
    expect(keys).toContain('notifications.telegram_enabled');
    expect(keys).toContain('notifications.telegram_bot_token');
    expect(keys).toContain('notifications.telegram_chat_id');
  });

  it('should have correct types for Discord settings', async () => {
    const { DEFAULT_SETTINGS } = await import('./shared');

    const discordEnabled = DEFAULT_SETTINGS.notifications.find((s) => s.key === 'notifications.discord_enabled');
    expect(discordEnabled?.type).toBe('boolean');
    expect(discordEnabled?.defaultValue).toBe('false');

    const discordUrl = DEFAULT_SETTINGS.notifications.find((s) => s.key === 'notifications.discord_webhook_url');
    expect(discordUrl?.type).toBe('password');
  });

  it('should have correct types for Telegram settings', async () => {
    const { DEFAULT_SETTINGS } = await import('./shared');

    const telegramEnabled = DEFAULT_SETTINGS.notifications.find((s) => s.key === 'notifications.telegram_enabled');
    expect(telegramEnabled?.type).toBe('boolean');
    expect(telegramEnabled?.defaultValue).toBe('false');

    const telegramToken = DEFAULT_SETTINGS.notifications.find((s) => s.key === 'notifications.telegram_bot_token');
    expect(telegramToken?.type).toBe('password');

    const telegramChatId = DEFAULT_SETTINGS.notifications.find((s) => s.key === 'notifications.telegram_chat_id');
    expect(telegramChatId?.type).toBe('string');
  });
});
