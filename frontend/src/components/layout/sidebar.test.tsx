import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Sidebar } from './sidebar';

vi.mock('@/hooks/use-remediation', () => ({
  useRemediationActions: vi.fn(),
}));

import { useRemediationActions } from '@/hooks/use-remediation';

const mockUseRemediationActions = vi.mocked(useRemediationActions);

function renderSidebar() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Sidebar', () => {
  it('shows pending remediation count as badge', () => {
    mockUseRemediationActions.mockReturnValue({
      data: [
        { id: '1', type: 'restart', status: 'pending', containerId: 'c1', endpointId: 1, description: 'test', suggestedBy: 'ai', createdAt: '', updatedAt: '' },
        { id: '2', type: 'restart', status: 'pending', containerId: 'c2', endpointId: 1, description: 'test', suggestedBy: 'ai', createdAt: '', updatedAt: '' },
      ],
    } as any);

    renderSidebar();

    const badge = screen.getByText('2');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveClass('bg-destructive');
  });

  it('shows no badge when there are zero pending actions', () => {
    mockUseRemediationActions.mockReturnValue({
      data: [],
    } as any);

    renderSidebar();

    // Remediation link should exist but no badge
    expect(screen.getByText('Remediation')).toBeInTheDocument();
    // No destructive badge elements should exist
    const badges = document.querySelectorAll('.bg-destructive');
    expect(badges).toHaveLength(0);
  });

  it('shows no badge when data is undefined (loading)', () => {
    mockUseRemediationActions.mockReturnValue({
      data: undefined,
    } as any);

    renderSidebar();

    expect(screen.getByText('Remediation')).toBeInTheDocument();
    const badges = document.querySelectorAll('.bg-destructive');
    expect(badges).toHaveLength(0);
  });

  it('renders sliding active indicator on current route item', () => {
    mockUseRemediationActions.mockReturnValue({
      data: [],
    } as any);

    renderSidebar();

    expect(screen.getByTestId('sidebar-active-indicator')).toBeInTheDocument();
  });
});
