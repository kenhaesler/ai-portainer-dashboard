import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NotificationTestButtons } from './settings';

const mockPost = vi.fn();
const mockSuccess = vi.fn();
const mockError = vi.fn();

vi.mock('@/lib/api', () => ({
  api: {
    post: (...args: unknown[]) => mockPost(...args),
  },
}));

vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => mockSuccess(...args),
    error: (...args: unknown[]) => mockError(...args),
  },
}));

describe('Settings notification test actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows success toast when API returns success true', async () => {
    mockPost.mockResolvedValue({ success: true });

    render(<NotificationTestButtons />);
    fireEvent.click(screen.getByRole('button', { name: /test teams/i }));

    await waitFor(() => {
      expect(mockSuccess).toHaveBeenCalledWith('Test teams notification sent successfully');
    });
    expect(mockError).not.toHaveBeenCalled();
  });

  it('shows error toast when API returns success false', async () => {
    mockPost.mockResolvedValue({ success: false, error: 'Webhook URL not configured' });

    render(<NotificationTestButtons />);
    fireEvent.click(screen.getByRole('button', { name: /test teams/i }));

    await waitFor(() => {
      expect(mockError).toHaveBeenCalledWith('Failed to send test teams notification: Webhook URL not configured');
    });
    expect(mockSuccess).not.toHaveBeenCalled();
  });
});
