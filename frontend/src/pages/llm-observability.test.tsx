import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

// Stub matchMedia for useReducedMotion / useCountUp in KpiCard
beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

const mockStats = {
  totalQueries: 142,
  totalTokens: 58300,
  avgLatencyMs: 1250,
  errorRate: 0.03,
  avgFeedbackScore: 4.2,
  feedbackCount: 37,
  modelBreakdown: [
    { model: 'llama3.2', count: 120, tokens: 48000 },
    { model: 'mistral', count: 22, tokens: 10300 },
  ],
};

const mockTraces = [
  {
    id: 1,
    trace_id: 'tr-001',
    session_id: null,
    model: 'llama3.2',
    prompt_tokens: 150,
    completion_tokens: 250,
    total_tokens: 400,
    latency_ms: 1100,
    status: 'success',
    user_query: 'What containers are using the most memory?',
    response_preview: 'Based on the metrics...',
    created_at: '2025-01-15 10:30:00',
  },
  {
    id: 2,
    trace_id: 'tr-002',
    session_id: null,
    model: 'llama3.2',
    prompt_tokens: 100,
    completion_tokens: 0,
    total_tokens: 100,
    latency_ms: 500,
    status: 'error',
    user_query: 'Show CPU anomalies',
    response_preview: null,
    created_at: '2025-01-15 10:25:00',
  },
];

// Mock hooks
vi.mock('@/hooks/use-llm-observability', () => ({
  useLlmTraces: vi.fn().mockReturnValue({ data: [], isLoading: false, refetch: vi.fn() }),
  useLlmStats: vi.fn().mockReturnValue({ data: null, isLoading: false, refetch: vi.fn() }),
}));

vi.mock('@/hooks/use-auto-refresh', () => ({
  useAutoRefresh: vi.fn().mockReturnValue({ interval: 0, setInterval: vi.fn() }),
}));

import { useLlmTraces, useLlmStats } from '@/hooks/use-llm-observability';
import LlmObservabilityPage from './llm-observability';

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <LlmObservabilityPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('LlmObservabilityPage', () => {
  it('renders the page title and subtitle', () => {
    renderPage();
    expect(screen.getByText('LLM Observability')).toBeTruthy();
    expect(screen.getByText('Monitor LLM usage and performance')).toBeTruthy();
  });

  it('shows empty state when no traces exist', () => {
    renderPage();
    expect(screen.getByText('No LLM traces yet')).toBeTruthy();
    expect(
      screen.getByText('LLM interactions will appear here once the assistant is used.')
    ).toBeTruthy();
  });

  it('renders KPI cards with stats data', () => {
    vi.mocked(useLlmStats).mockReturnValue({
      data: mockStats,
      isLoading: false,
      refetch: vi.fn(),
    } as ReturnType<typeof useLlmStats>);

    renderPage();
    expect(screen.getByText('Total Queries')).toBeTruthy();
    expect(screen.getByText('Total Tokens')).toBeTruthy();
    expect(screen.getByText('Avg Latency')).toBeTruthy();
    expect(screen.getByText('Error Rate')).toBeTruthy();
  });

  it('renders model breakdown table with data', () => {
    vi.mocked(useLlmStats).mockReturnValue({
      data: mockStats,
      isLoading: false,
      refetch: vi.fn(),
    } as ReturnType<typeof useLlmStats>);

    renderPage();
    expect(screen.getByText('Model Breakdown')).toBeTruthy();
    expect(screen.getByText('Share')).toBeTruthy();
    expect(screen.getByText('llama3.2')).toBeTruthy();
    expect(screen.getByText('mistral')).toBeTruthy();
    expect(screen.getByLabelText('llama3.2 share')).toBeTruthy();
  });

  it('renders feedback summary with score', () => {
    vi.mocked(useLlmStats).mockReturnValue({
      data: mockStats,
      isLoading: false,
      refetch: vi.fn(),
    } as ReturnType<typeof useLlmStats>);

    renderPage();
    expect(screen.getByText('Feedback Summary')).toBeTruthy();
    expect(screen.getByText('4.2')).toBeTruthy();
    expect(screen.getByText('/ 5')).toBeTruthy();
    expect(screen.getByText('Quality Signal')).toBeTruthy();
    expect(screen.getByText('Good')).toBeTruthy();
    expect(screen.getByText('Confidence')).toBeTruthy();
    expect(screen.getByText('High')).toBeTruthy();
  });

  it('shows low-confidence guidance when rating sample is small', () => {
    vi.mocked(useLlmStats).mockReturnValue({
      data: {
        ...mockStats,
        avgFeedbackScore: 3.2,
        feedbackCount: 4,
      },
      isLoading: false,
      refetch: vi.fn(),
    } as ReturnType<typeof useLlmStats>);

    renderPage();
    expect(screen.getByText('Mixed')).toBeTruthy();
    expect(screen.getByText('Low')).toBeTruthy();
    expect(screen.getByText('Collect more ratings for stronger confidence in quality trends.')).toBeTruthy();
  });

  it('renders when stats payload is missing model breakdown', () => {
    vi.mocked(useLlmStats).mockReturnValue({
      data: {
        totalQueries: 10,
        totalTokens: 1200,
        avgLatencyMs: 700,
        errorRate: 0,
        avgFeedbackScore: null,
        feedbackCount: 0,
      } as unknown as ReturnType<typeof useLlmStats>['data'],
      isLoading: false,
      refetch: vi.fn(),
    } as ReturnType<typeof useLlmStats>);

    renderPage();
    expect(screen.getByText('Model Breakdown')).toBeTruthy();
    expect(screen.getByText('No model data available.')).toBeTruthy();
  });


  it('renders traces table with data', () => {
    vi.mocked(useLlmStats).mockReturnValue({
      data: mockStats,
      isLoading: false,
      refetch: vi.fn(),
    } as ReturnType<typeof useLlmStats>);
    vi.mocked(useLlmTraces).mockReturnValue({
      data: mockTraces,
      isLoading: false,
      refetch: vi.fn(),
    } as ReturnType<typeof useLlmTraces>);

    renderPage();
    expect(screen.getByText('What containers are using the most memory?')).toBeTruthy();
    expect(screen.getByText('Show CPU anomalies')).toBeTruthy();
    expect(screen.getByText('success')).toBeTruthy();
    expect(screen.getByText('error')).toBeTruthy();
  });

  it('blurs query column by default and reveals on toggle', () => {
    vi.mocked(useLlmTraces).mockReturnValue({
      data: mockTraces,
      isLoading: false,
      refetch: vi.fn(),
    } as ReturnType<typeof useLlmTraces>);

    renderPage();
    const queryCell = screen.getByText('What containers are using the most memory?');

    // Privacy mode is ON by default — cell should have blur class
    expect(queryCell.closest('td')?.className).toContain('blur-sm');

    // Click the Privacy toggle button to reveal
    fireEvent.click(screen.getByText('Privacy'));
    expect(queryCell.closest('td')?.className).not.toContain('blur-sm');

    // Click again to re-blur
    fireEvent.click(screen.getByText('Privacy'));
    expect(queryCell.closest('td')?.className).toContain('blur-sm');
  });

  it('renders skeleton cards during loading', () => {
    vi.mocked(useLlmStats).mockReturnValue({
      data: undefined,
      isLoading: true,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useLlmStats>);

    const { container } = renderPage();
    const skeletons = container.querySelectorAll('[role="status"]');
    expect(skeletons.length).toBeGreaterThan(0);
  });
});
