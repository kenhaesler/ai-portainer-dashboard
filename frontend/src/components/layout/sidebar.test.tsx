import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Sidebar } from './sidebar';

const mockUseRemediationActions = vi.fn();

vi.mock('@/hooks/use-remediation', () => ({
  useRemediationActions: (...args: unknown[]) => mockUseRemediationActions(...args),
}));

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
  it('shows badge with pending remediation count when actions exist', () => {
    mockUseRemediationActions.mockReturnValue({
      data: [{ id: '1' }, { id: '2' }, { id: '3' }, { id: '4' }, { id: '5' }],
    });
    renderSidebar();
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('hides badge when there are no pending remediation actions', () => {
    mockUseRemediationActions.mockReturnValue({ data: [] });
    renderSidebar();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
    // The destructive badge should not be rendered
    const badges = document.querySelectorAll('.bg-destructive');
    expect(badges.length).toBe(0);
  });

  it('hides badge when remediation data is loading', () => {
    mockUseRemediationActions.mockReturnValue({ data: undefined });
    renderSidebar();
    const badges = document.querySelectorAll('.bg-destructive');
    expect(badges.length).toBe(0);
  });
});
