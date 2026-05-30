/**
 * Tests for the SensitivityControl component (issue #1297).
 *
 * Verifies:
 *   - Renders all three presets (Low / Default / High).
 *   - Loads and reflects the GET response.
 *   - Clicking a segment triggers a PUT and optimistically updates.
 *   - Rolls back on PUT failure and surfaces the error.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type PropsWithChildren } from 'react';

const apiGet = vi.fn();
const apiPut = vi.fn();

vi.mock('@/shared/lib/api', () => ({
  api: { get: (...args: unknown[]) => apiGet(...args), put: (...args: unknown[]) => apiPut(...args) },
}));

import { SensitivityControl } from './sensitivity-control';

function wrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return ({ children }: PropsWithChildren) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
}

beforeEach(() => {
  apiGet.mockReset();
  apiPut.mockReset();
});

describe('SensitivityControl', () => {
  it('renders Low / Default / High segments', async () => {
    apiGet.mockResolvedValue({ preset: 'default' });
    render(<SensitivityControl />, { wrapper: wrapper() });

    await waitFor(() => {
      expect(screen.getByTestId('sensitivity-low')).toBeTruthy();
      expect(screen.getByTestId('sensitivity-default')).toBeTruthy();
      expect(screen.getByTestId('sensitivity-high')).toBeTruthy();
    });
  });

  it('shows the GET response preset as the active segment', async () => {
    apiGet.mockResolvedValue({ preset: 'high' });
    render(<SensitivityControl />, { wrapper: wrapper() });

    await waitFor(() => {
      const high = screen.getByTestId('sensitivity-high');
      expect(high.getAttribute('aria-pressed')).toBe('true');
    });
    const def = screen.getByTestId('sensitivity-default');
    expect(def.getAttribute('aria-pressed')).toBe('false');
  });

  it('clicking a preset triggers a PUT with that value', async () => {
    apiGet.mockResolvedValue({ preset: 'default' });
    apiPut.mockResolvedValue({ preset: 'low' });

    render(<SensitivityControl />, { wrapper: wrapper() });

    await waitFor(() => screen.getByTestId('sensitivity-default'));
    await act(async () => {
      fireEvent.click(screen.getByTestId('sensitivity-low'));
    });

    await waitFor(() => {
      expect(apiPut).toHaveBeenCalledWith('/api/monitoring/sensitivity', { preset: 'low' });
    });
  });

  it('optimistically updates the active segment before the PUT resolves', async () => {
    apiGet.mockResolvedValue({ preset: 'default' });
    // PUT never resolves during this test so we can observe the optimistic
    // state.
    apiPut.mockImplementation(() => new Promise(() => {}));

    render(<SensitivityControl />, { wrapper: wrapper() });
    await waitFor(() => screen.getByTestId('sensitivity-default'));

    await act(async () => {
      fireEvent.click(screen.getByTestId('sensitivity-high'));
    });

    // No network round-trip required — the cache has already been written.
    await waitFor(() => {
      expect(screen.getByTestId('sensitivity-high').getAttribute('aria-pressed')).toBe('true');
    });
  });

  it('rolls back the segment on PUT failure and shows an error', async () => {
    apiGet.mockResolvedValue({ preset: 'default' });
    apiPut.mockRejectedValue(new Error('boom'));

    render(<SensitivityControl />, { wrapper: wrapper() });
    await waitFor(() => screen.getByTestId('sensitivity-default'));

    await act(async () => {
      fireEvent.click(screen.getByTestId('sensitivity-high'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('sensitivity-error')).toBeTruthy();
    });
    // Rolled back to default.
    expect(screen.getByTestId('sensitivity-default').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('sensitivity-high').getAttribute('aria-pressed')).toBe('false');
  });

  // Finding #3 (PR #1304 review): tooltip on each preset segment must call
  // out that the filter only applies to z-score-based anomalies, so users
  // know predictive forecasts are always shown.
  it('tooltips explain that predictive forecasts are always shown', async () => {
    apiGet.mockResolvedValue({ preset: 'default' });
    render(<SensitivityControl />, { wrapper: wrapper() });

    await waitFor(() => screen.getByTestId('sensitivity-default'));

    const passthrough =
      'Filters z-score-based anomalies. Predictive forecasts are always shown.';
    expect(screen.getByTestId('sensitivity-low').getAttribute('title')).toContain(passthrough);
    expect(screen.getByTestId('sensitivity-default').getAttribute('title')).toContain(passthrough);
    expect(screen.getByTestId('sensitivity-high').getAttribute('title')).toContain(passthrough);
  });

  it('does not call PUT when clicking the already-active segment', async () => {
    apiGet.mockResolvedValue({ preset: 'high' });
    render(<SensitivityControl />, { wrapper: wrapper() });

    await waitFor(() => {
      expect(screen.getByTestId('sensitivity-high').getAttribute('aria-pressed')).toBe('true');
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('sensitivity-high'));
    });
    expect(apiPut).not.toHaveBeenCalled();
  });
});
