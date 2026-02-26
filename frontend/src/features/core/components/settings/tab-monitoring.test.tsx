import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { NotificationTestButtons } from './tab-monitoring';

// Mock the api module
vi.mock('@/lib/api', () => ({
  api: {
    post: vi.fn(),
  },
}));

// Mock sonner toast
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import { api } from '@/lib/api';
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
