import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ComponentProps } from 'react';
import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockUseCorrelations = vi.fn();
const mockUseCorrelationInsights = vi.fn();

// Passthrough mock: only the two data hooks are stubbed. `correlationPairKey`
// is a pure function and stays real — it is the join key the component and the
// server agree on, so a stubbed version would let a mismatch pass unnoticed.
vi.mock('@/features/observability/hooks/use-correlations', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/observability/hooks/use-correlations')>()),
  useCorrelations: (...args: unknown[]) => mockUseCorrelations(...args),
  useCorrelationInsights: (...args: unknown[]) => mockUseCorrelationInsights(...args),
}));

import {
  CorrelationInsightsPanel,
  commonAxisPrefix,
  shortenAxisLabels,
} from './correlation-insights-panel';

// Props come from the component itself, not a hand-copied shape: the local copy
// had drifted and omitted `selectedContainerId`, so the three tests that pass it
// were type-checked against a prop list the component outgrew.
function renderPanel(props: ComponentProps<typeof CorrelationInsightsPanel>) {
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

  it('states why narratives are missing once, not per row', () => {
    // Previously each row printed an italic "Insight unavailable", so a single
    // unparseable model response rendered the same failure ten times with no
    // cause and no retry. The reason is now said once above the list, and the
    // correlation values — which are computed from metrics and stand on their
    // own — keep the panel useful when the model does not answer.
    mockUseCorrelations.mockReturnValue({
      data: { pairs: samplePairs },
      isLoading: false,
    });
    mockUseCorrelationInsights.mockReturnValue({
      data: {
        insights: [],
        summary: null,
        narrativeStatus: 'unparsed',
        narrativeUnavailableReason:
          'The model returned an unrecognised format, so explanations are unavailable for these pairs.',
      },
      isLoading: false,
    });
    renderPanel({ llmAvailable: true });

    const reason = screen.getByTestId('narrative-unavailable-reason');
    expect(reason).toBeInTheDocument();
    expect(reason).toHaveAttribute('data-narrative-status', 'unparsed');
    expect(screen.getAllByTestId('narrative-unavailable-reason')).toHaveLength(1);
    expect(screen.queryByText('Insight unavailable')).not.toBeInTheDocument();

    // The correlation data itself still renders.
    expect(screen.getAllByText('nginx-proxy').length).toBeGreaterThan(0);
  });

  it('does not show an unavailable reason when narratives parsed cleanly', () => {
    mockUseCorrelations.mockReturnValue({
      data: { pairs: [samplePairs[0]] },
      isLoading: false,
    });
    mockUseCorrelationInsights.mockReturnValue({
      data: {
        insights: [],
        summary: null,
        narrativeStatus: 'ok',
        narrativeUnavailableReason: null,
      },
      isLoading: false,
    });
    renderPanel({ llmAvailable: true });

    expect(
      screen.queryByTestId('narrative-unavailable-reason'),
    ).not.toBeInTheDocument();
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

  // Red meant "container crashes" and green meant "healthy" in this palette, so
  // painting r = -0.87 red asserted the pair was broken. Colour now carries
  // |r| only; the sign is in the printed coefficient and the trend glyph.
  describe('coefficient colour is keyed to magnitude, not sign', () => {
    function badgeFor(text: string): HTMLElement {
      const el = screen.getByText((_content, node) => node?.textContent?.trim() === text
        && node.classList.contains('rounded-full'));
      return el;
    }

    beforeEach(() => {
      mockUseCorrelations.mockReturnValue({
        data: { pairs: samplePairs },
        isLoading: false,
      });
    });

    it('gives the same classes to r = 0.94 and r = -0.94', () => {
      mockUseCorrelations.mockReturnValue({
        data: {
          pairs: [
            { ...samplePairs[0], correlation: 0.94 },
            {
              ...samplePairs[1],
              correlation: -0.94,
              direction: 'negative' as const,
              strength: 'very_strong' as const,
            },
          ],
        },
        isLoading: false,
      });
      renderPanel({ llmAvailable: false });

      const positive = badgeFor('r = 0.94');
      const negative = badgeFor('r = -0.94');
      expect(positive.className).toBe(negative.className);
    });

    it('uses no status colour for either sign', () => {
      renderPanel({ llmAvailable: false });

      for (const text of ['r = 0.94', 'r = -0.87']) {
        const cls = badgeFor(text).className;
        expect(cls).not.toMatch(/emerald|red-|orange|green/);
      }
    });

    it('still shows the direction glyph and the signed value', () => {
      renderPanel({ llmAvailable: false });

      expect(badgeFor('r = -0.87').querySelector('svg')).toBeTruthy();
      expect(screen.getByText('r = -0.87')).toBeInTheDocument();
    });
  });

  describe('heatmap axis labels', () => {
    it('drops the prefix every container shares and keeps the tail', () => {
      // In a compose fleet the shared project prefix is the *only* part the old
      // `slice(0, 10)` kept, so six of twelve columns read "container-…".
      const names = [
        'container-insights-backend-1',
        'container-insights-frontend-1',
        'container-insights-postgres-app-1',
      ];
      expect(commonAxisPrefix(names)).toBe('container-insights-');

      const labels = shortenAxisLabels(names);
      expect(labels.get('container-insights-backend-1')).toBe('backend-1');
      expect(labels.get('container-insights-frontend-1')).toBe('frontend-1');
      // Still too long after stripping → truncate from the LEFT, keep the tail.
      expect(labels.get('container-insights-postgres-app-1')).toBe('…stgres-app-1');
      expect(labels.get('container-insights-postgres-app-1')).toMatch(/-1$/);
    });

    it('leaves labels alone when they share no prefix at a word boundary', () => {
      const names = ['nginx-proxy', 'api-server', 'postgres'];
      expect(commonAxisPrefix(names)).toBe('');
      expect(shortenAxisLabels(names).get('nginx-proxy')).toBe('nginx-proxy');
    });

    it('does not strip a prefix that would empty a label', () => {
      // 'web-' is common but 'web-' IS one of the names once stripped.
      expect(commonAxisPrefix(['web-1', 'web-'])).toBe('');
      expect(commonAxisPrefix(['solo'])).toBe('');
    });

    it('renders the shortened labels and keeps the full name in the title', () => {
      mockUseCorrelations.mockReturnValue({
        data: {
          pairs: [
            {
              ...samplePairs[0],
              containerA: { id: 'a1', name: 'container-insights-backend-1' },
              containerB: { id: 'b1', name: 'container-insights-frontend-1' },
            },
            {
              ...samplePairs[1],
              containerA: { id: 'c1', name: 'container-insights-backend-1' },
              containerB: { id: 'd1', name: 'container-insights-redis-1' },
            },
          ],
        },
        isLoading: false,
      });
      renderPanel({ llmAvailable: false });

      const heatmap = screen.getByTestId('correlation-heatmap');
      const header = within(heatmap).getAllByRole('columnheader')[1];
      expect(header.textContent).toBe('backend-1');
      expect(header).toHaveAttribute('title', 'container-insights-backend-1');
      expect(screen.getByTestId('heatmap-prefix-note').textContent).toContain('container-insights-');
    });
  });
});
