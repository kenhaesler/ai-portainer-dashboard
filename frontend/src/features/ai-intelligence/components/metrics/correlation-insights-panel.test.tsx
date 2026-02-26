import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockUseCorrelations = vi.fn();
const mockUseCorrelationInsights = vi.fn();

vi.mock('@/features/observability/hooks/use-correlations', () => ({
  useCorrelations: (...args: unknown[]) => mockUseCorrelations(...args),
  useCorrelationInsights: (...args: unknown[]) => mockUseCorrelationInsights(...args),
}));

import { CorrelationInsightsPanel } from './correlation-insights-panel';

function renderPanel(props: { llmAvailable: boolean; hours?: number }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <CorrelationInsightsPanel {...props} />
    </QueryClientProvider>,
  );
}

const samplePairs = [
  {
    containerA: { id: 'a1', name: 'nginx-proxy' },
    containerB: { id: 'b1', name: 'api-server' },
    metricType: 'cpu',
    correlation: 0.94,
    strength: 'very_strong' as const,
    direction: 'positive' as const,
    sampleCount: 100,
  },
  {
    containerA: { id: 'c1', name: 'postgres' },
    containerB: { id: 'd1', name: 'redis-cache' },
    metricType: 'memory',
    correlation: -0.87,
    strength: 'strong' as const,
    direction: 'negative' as const,
    sampleCount: 80,
  },
];

describe('CorrelationInsightsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseCorrelations.mockReturnValue({ data: { pairs: [] }, isLoading: false });
    mockUseCorrelationInsights.mockReturnValue({ data: { insights: [], summary: null }, isLoading: false });
  });

  it('renders the panel title', () => {
    renderPanel({ llmAvailable: true });
    expect(screen.getByText('Cross-Container Correlation Insights')).toBeInTheDocument();
  });

  it('shows empty state when no correlations detected', () => {
    renderPanel({ llmAvailable: true });
    expect(screen.getByText('No strong correlations detected')).toBeInTheDocument();
  });

  it('shows loading skeleton while pairs are loading', () => {
    mockUseCorrelations.mockReturnValue({ data: undefined, isLoading: true });
    renderPanel({ llmAvailable: true });
    // Should show the title + skeleton divs
    expect(screen.getByText('Cross-Container Correlation Insights')).toBeInTheDocument();
    // Check for animate-pulse skeletons (loading state)
    const skeletons = document.querySelectorAll('.animate-pulse');
    expect(skeletons.length).toBeGreaterThanOrEqual(1);
  });

  it('renders correlation pair cards', () => {
    mockUseCorrelations.mockReturnValue({
      data: { pairs: samplePairs },
      isLoading: false,
    });
    renderPanel({ llmAvailable: false });

    expect(screen.getAllByText('nginx-proxy').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('api-server').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('postgres').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('redis-cache').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('2 correlated pairs')).toBeInTheDocument();
  });

  it('renders heatmap grid when multiple pairs exist', () => {
    mockUseCorrelations.mockReturnValue({
      data: { pairs: samplePairs },
      isLoading: false,
    });
    renderPanel({ llmAvailable: false });

    expect(screen.getByText('Correlation Heatmap')).toBeInTheDocument();
    expect(screen.getByTestId('correlation-heatmap')).toBeInTheDocument();
  });

  it('renders AI narratives for each pair when LLM available', () => {
    mockUseCorrelations.mockReturnValue({
      data: { pairs: samplePairs },
      isLoading: false,
    });
    mockUseCorrelationInsights.mockReturnValue({
      data: {
        insights: [
          {
            containerA: 'nginx-proxy',
            containerB: 'api-server',
            metricType: 'cpu',
            correlation: 0.94,
            narrative: 'CPU coupling due to proxied request load.',
          },
          {
            containerA: 'postgres',
            containerB: 'redis-cache',
            metricType: 'memory',
            correlation: -0.87,
            narrative: 'Inverse memory: cache eviction during heavy queries.',
          },
        ],
        summary: 'Two notable cross-container relationships detected.',
      },
      isLoading: false,
    });
    renderPanel({ llmAvailable: true });

    expect(screen.getByText('CPU coupling due to proxied request load.')).toBeInTheDocument();
    expect(screen.getByText('Inverse memory: cache eviction during heavy queries.')).toBeInTheDocument();
    // Fleet summary
    expect(screen.getByText('Fleet Summary')).toBeInTheDocument();
    expect(screen.getByText('Two notable cross-container relationships detected.')).toBeInTheDocument();
  });

  it('hides AI narratives when LLM is unavailable', () => {
    mockUseCorrelations.mockReturnValue({
      data: { pairs: samplePairs },
      isLoading: false,
    });
    renderPanel({ llmAvailable: false });

    // Should not show any AI insight text or Fleet Summary
    expect(screen.queryByText('Fleet Summary')).not.toBeInTheDocument();
    expect(screen.queryByText('Insight unavailable')).not.toBeInTheDocument();
  });

  it('shows insight loading skeletons when insights are loading', () => {
    mockUseCorrelations.mockReturnValue({
      data: { pairs: samplePairs },
      isLoading: false,
    });
    mockUseCorrelationInsights.mockReturnValue({
      data: undefined,
      isLoading: true,
    });
    renderPanel({ llmAvailable: true });

    // Should have animate-pulse elements for narrative loading
    const skeletons = document.querySelectorAll('.animate-pulse');
    expect(skeletons.length).toBeGreaterThanOrEqual(2);
  });

  it('shows fallback text when narrative is null', () => {
    mockUseCorrelations.mockReturnValue({
      data: { pairs: [samplePairs[0]] },
      isLoading: false,
    });
    mockUseCorrelationInsights.mockReturnValue({
      data: {
        insights: [{
          containerA: 'nginx-proxy',
          containerB: 'api-server',
          metricType: 'cpu',
          correlation: 0.94,
          narrative: null,
        }],
        summary: null,
      },
      isLoading: false,
    });
    renderPanel({ llmAvailable: true });

    expect(screen.getByText('Insight unavailable')).toBeInTheDocument();
  });

  it('renders correlation coefficient values', () => {
    mockUseCorrelations.mockReturnValue({
      data: { pairs: samplePairs },
      isLoading: false,
    });
    renderPanel({ llmAvailable: false });

    expect(screen.getByText('r = 0.94')).toBeInTheDocument();
    expect(screen.getByText('r = -0.87')).toBeInTheDocument();
  });

  it('shows metric type badges', () => {
    mockUseCorrelations.mockReturnValue({
      data: { pairs: samplePairs },
      isLoading: false,
    });
    renderPanel({ llmAvailable: false });

    expect(screen.getByText('cpu')).toBeInTheDocument();
    expect(screen.getByText('memory')).toBeInTheDocument();
  });

  it('filters pairs to selected container when selectedContainerId is set', () => {
    mockUseCorrelations.mockReturnValue({
      data: { pairs: samplePairs },
      isLoading: false,
    });
    // Select nginx-proxy (id: a1) — should only show the CPU pair
    renderPanel({ llmAvailable: false, selectedContainerId: 'a1' });

    expect(screen.getAllByText('nginx-proxy').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('api-server').length).toBeGreaterThanOrEqual(1);
    // postgres/redis pair should be filtered out
    expect(screen.queryByText('postgres')).not.toBeInTheDocument();
    expect(screen.queryByText('redis-cache')).not.toBeInTheDocument();
    expect(screen.getByText('1 correlated pair')).toBeInTheDocument();
  });

  it('shows all pairs when no container is selected', () => {
    mockUseCorrelations.mockReturnValue({
      data: { pairs: samplePairs },
      isLoading: false,
    });
    renderPanel({ llmAvailable: false, selectedContainerId: null });

    expect(screen.getByText('2 correlated pairs')).toBeInTheDocument();
  });

  it('shows contextual subtitle when container is selected', () => {
    mockUseCorrelations.mockReturnValue({
      data: { pairs: samplePairs },
      isLoading: false,
    });
    renderPanel({ llmAvailable: false, selectedContainerId: 'a1' });

    expect(screen.getByText(/Relationships for selected container/)).toBeInTheDocument();
  });
});
