import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { InsightCard, type InsightCardProps } from './insight-card';
import type { AnomalyDimension } from '@dashboard/contracts';

/**
 * Regression coverage for #1296 / PR #1306 — when a trace-anomaly insight
 * collapses co-occurring p95 + error-rate signals into a single record, the
 * UI must surface each underlying dimension instead of hiding the payload
 * inside the JSONB column. Mirrors the styling of `CorrelatedAnomalyCard`
 * on the AI monitor page.
 */

function makeInsight(
  overrides: Partial<InsightCardProps['insight']> = {},
): InsightCardProps['insight'] {
  return {
    id: 'insight-1',
    endpoint_id: 1,
    endpoint_name: 'local',
    container_id: 'svc-api',
    container_name: 'api',
    severity: 'critical',
    category: 'anomaly',
    title: 'Correlated anomaly on service "api" (latency_p95 + error_rate)',
    description: 'Both signals crossed threshold in the same minute bucket.',
    suggested_action: null,
    is_acknowledged: 0,
    created_at: '2026-05-14T13:00:00Z',
    ...overrides,
  };
}

function wrap(node: React.ReactNode) {
  return <MemoryRouter>{node}</MemoryRouter>;
}

describe('InsightCard — dimensions breakdown (#1296)', () => {
  it('does not render the dimensions section for legacy single-signal insights', async () => {
    render(
      wrap(
        <InsightCard
          insight={makeInsight()}
          onAcknowledge={() => undefined}
          isAcknowledging={false}
        />,
      ),
    );
    // Expand the card so the body is mounted.
    await userEvent.click(screen.getByRole('button', { name: /Correlated anomaly/ }));
    expect(screen.queryByTestId('insight-dimension-bars')).not.toBeInTheDocument();
    expect(screen.queryByText('Correlated Signals')).not.toBeInTheDocument();
  });

  it('renders one z-score bar per dimension for a 2-signal correlated insight', async () => {
    const dimensions: AnomalyDimension[] = [
      { type: 'latency_p95', value: 800, baseline: 20, zScore: 4.8, severity: 'critical' },
      { type: 'error_rate', value: 0.12, baseline: 0.005, zScore: 2.3, severity: 'warning' },
    ];
    render(
      wrap(
        <InsightCard
          insight={makeInsight({ dimensions })}
          onAcknowledge={() => undefined}
          isAcknowledging={false}
        />,
      ),
    );
    await userEvent.click(screen.getByRole('button', { name: /Correlated anomaly/ }));

    const bars = screen.getByTestId('insight-dimension-bars');
    expect(bars).toBeInTheDocument();
    // One row per dimension, each labelled with its `type`.
    expect(screen.getByTestId('insight-dimension-latency_p95')).toBeInTheDocument();
    expect(screen.getByTestId('insight-dimension-error_rate')).toBeInTheDocument();
    // Z-score labels reflect the underlying values to one decimal place.
    expect(within(bars).getByText('4.8')).toBeInTheDocument();
    expect(within(bars).getByText('2.3')).toBeInTheDocument();

    // Value + baseline detail block surfaces both signals.
    expect(screen.getByText(/baseline 20\.00/)).toBeInTheDocument();
    expect(screen.getByText(/baseline 0\.01/)).toBeInTheDocument();
  });

  it('applies the red severity band for |z| >= 3, amber for 2-3, blue otherwise (mirrors CorrelatedAnomalyCard)', async () => {
    const dimensions: AnomalyDimension[] = [
      { type: 'latency_p95', value: 800, baseline: 20, zScore: 4.8, severity: 'critical' }, // red
      { type: 'error_rate', value: 0.12, baseline: 0.005, zScore: 2.3, severity: 'warning' }, // amber
      { type: 'cpu', value: 30, baseline: 25, zScore: 1.4, severity: 'warning' },             // blue
    ];
    const { container } = render(
      wrap(
        <InsightCard
          insight={makeInsight({ dimensions })}
          onAcknowledge={() => undefined}
          isAcknowledging={false}
        />,
      ),
    );
    await userEvent.click(screen.getByRole('button', { name: /Correlated anomaly/ }));

    // The bar element is the inner `div` whose className includes the
    // severity-band utility class. Pulling them out of the rendered DOM
    // keeps the assertion concrete without coupling to internal markup
    // beyond what the visual band guarantees.
    const redBars = container.querySelectorAll('.bg-red-500');
    const amberBars = container.querySelectorAll('.bg-amber-500');
    const blueBars = container.querySelectorAll('.bg-blue-500');
    expect(redBars.length).toBe(1);
    expect(amberBars.length).toBe(1);
    expect(blueBars.length).toBe(1);
  });

  it('renders nothing for an empty dimensions array (defensive — collapsed JSONB never empties to []) ', async () => {
    render(
      wrap(
        <InsightCard
          insight={makeInsight({ dimensions: [] })}
          onAcknowledge={() => undefined}
          isAcknowledging={false}
        />,
      ),
    );
    await userEvent.click(screen.getByRole('button', { name: /Correlated anomaly/ }));
    expect(screen.queryByTestId('insight-dimension-bars')).not.toBeInTheDocument();
    expect(screen.queryByText('Correlated Signals')).not.toBeInTheDocument();
  });
});
