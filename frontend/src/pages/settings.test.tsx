import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DefaultLandingPagePreference } from './settings';

const mockGet = vi.fn();
const mockPatch = vi.fn();
const mockSuccess = vi.fn();
const mockError = vi.fn();

vi.mock('@/lib/api', () => ({
  api: {
    get: (...args: unknown[]) => mockGet(...args),
    patch: (...args: unknown[]) => mockPatch(...args),
  },
}));

vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => mockSuccess(...args),
    error: (...args: unknown[]) => mockError(...args),
  },
}));

describe('DefaultLandingPagePreference', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockResolvedValue({ defaultLandingPage: '/workloads' });
    mockPatch.mockResolvedValue({ defaultLandingPage: '/workloads' });
  });

  it('loads and renders saved landing page preference', async () => {
    render(<DefaultLandingPagePreference />);

    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith('/api/settings/preferences');
    });

    expect(screen.getByLabelText('Default Landing Page')).toHaveValue('/workloads');
  });

  it('saves updated landing page preference', async () => {
    render(<DefaultLandingPagePreference />);

    await waitFor(() => {
      expect(screen.getByLabelText('Default Landing Page')).toHaveValue('/workloads');
    });

    fireEvent.change(screen.getByLabelText('Default Landing Page'), {
      target: { value: '/ai-monitor' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => {
      expect(mockPatch).toHaveBeenCalledWith('/api/settings/preferences', { defaultLandingPage: '/ai-monitor' });
      expect(mockSuccess).toHaveBeenCalledWith('Default landing page updated');
    });
  });
});
