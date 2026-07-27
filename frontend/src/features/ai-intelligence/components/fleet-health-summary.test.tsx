import { describe, it, expect, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ShieldAlert, PackageOpen } from 'lucide-react';
import { FleetHealthSummary, type InsightStats } from './fleet-health-summary';
import type { HealthStats } from '@/shared/lib/health-score';

const stats: HealthStats = {
  total: 10,
  running: 8,
  stopped: 2,
  paused: 0,
  dead: 0,
  unhealthy: 1,
  healthy: 7,
  unknown: 0,
  noHealthcheck: 0,
};

const insightStats: InsightStats = {
  total: 20,
  critical: 14,
  warning: 2,
  info: 4,
  unacknowledgedCritical: 14,
  unacknowledgedWarning: 2,
};

function renderSummary(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe('FleetHealthSummary', () => {
  it('renders the four container-status tiles by default', () => {
    renderSummary(<FleetHealthSummary stats={stats} isLoading={false} />);
    const hero = screen.getByTestId('fleet-health-hero');
    expect(within(hero).getByText('Running')).toBeInTheDocument();
    expect(within(hero).getByText('Healthy')).toBeInTheDocument();
    expect(within(hero).getByText('Unhealthy')).toBeInTheDocument();
    expect(within(hero).getByText('No Healthcheck')).toBeInTheDocument();
  });

  it('does not render extra tiles when none are provided (backward compatible)', () => {
    renderSummary(<FleetHealthSummary stats={stats} isLoading={false} />);
    expect(screen.queryByText('Security Findings')).not.toBeInTheDocument();
    expect(screen.queryByText('Stopped')).not.toBeInTheDocument();
  });

  it('renders provided extraTiles after the container tiles', () => {
    renderSummary(
      <FleetHealthSummary
        stats={stats}
        isLoading={false}
        statusColumns={3}
        extraTiles={[
          { icon: PackageOpen, label: 'Stopped', value: stats.stopped },
          { icon: ShieldAlert, label: 'Security Findings', value: 4, variant: 'danger' },
        ]}
      />,
    );
    const hero = screen.getByTestId('fleet-health-hero');
    expect(within(hero).getByText('Stopped')).toBeInTheDocument();
    expect(within(hero).getByText('Security Findings')).toBeInTheDocument();
    expect(within(hero).getByText('4')).toBeInTheDocument();
    // Non-interactive extra tiles must NOT be buttons.
    expect(within(hero).queryByRole('button', { name: /Stopped/i })).not.toBeInTheDocument();
    expect(within(hero).queryByRole('button', { name: /Security Findings/i })).not.toBeInTheDocument();
  });

  it('renders an extraTile with onClick as a button and fires the handler', () => {
    const onClick = vi.fn();
    renderSummary(
      <FleetHealthSummary
        stats={stats}
        isLoading={false}
        statusColumns={3}
        extraTiles={[{ icon: ShieldAlert, label: 'Security Findings', value: 4, onClick }]}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Security Findings/i }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('applies the requested column count to the status grid', () => {
    renderSummary(<FleetHealthSummary stats={stats} isLoading={false} statusColumns={3} />);
    const running = screen.getByText('Running');
    expect(running.closest('[class*="sm:grid-cols-3"]')).not.toBeNull();
  });

  // -------------------------------------------------------------------------
  // One denominator per row. Each tile used to print its own percentage of
  // `total` (11 · 85%) beside a hero reading 100.0% (11/11).
  // -------------------------------------------------------------------------

  it('states the denominator once and prints counts, not per-tile percentages', () => {
    renderSummary(<FleetHealthSummary stats={stats} isLoading={false} />);

    expect(screen.getByTestId('fleet-status-denominator')).toHaveTextContent('of 10 containers');
    const hero = screen.getByTestId('fleet-health-hero');
    // 8/10 running and 7/10 healthy used to render as "80%" / "70%" on the tiles.
    expect(within(hero).queryByText('80%')).not.toBeInTheDocument();
    expect(within(hero).queryByText('70%')).not.toBeInTheDocument();
  });

  it('links the Running and Unhealthy tiles to the rows behind them', () => {
    renderSummary(<FleetHealthSummary stats={stats} isLoading={false} />);

    expect(screen.getByTestId('fleet-tile-link-Running')).toHaveAttribute(
      'href',
      '/workloads?state=running',
    );
    expect(screen.getByTestId('fleet-tile-link-Unhealthy')).toHaveAttribute('href', '/health');
  });

  it('does not link a tile whose count is zero', () => {
    const clean: HealthStats = { ...stats, unhealthy: 0 };
    renderSummary(<FleetHealthSummary stats={clean} isLoading={false} />);

    expect(screen.queryByTestId('fleet-tile-link-Unhealthy')).not.toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Layout — /health asks the shared component for a different emphasis rather
  // than duplicating Home's top band verbatim.
  // -------------------------------------------------------------------------

  it('leads with insight tiles and collapses container status to one line', () => {
    renderSummary(
      <FleetHealthSummary
        stats={stats}
        isLoading={false}
        insightStats={insightStats}
        layout="insights-first"
      />,
    );

    expect(screen.getByTestId('fleet-status-line')).toHaveTextContent(
      '10 containers · 8 running · 7 healthy · 1 unhealthy · 0 without a healthcheck',
    );
    // The full status tile grid is not rendered in this layout.
    expect(screen.queryByText('No Healthcheck')).not.toBeInTheDocument();
    expect(screen.getByText('Total Insights')).toBeInTheDocument();
  });

  it('feeds unacknowledged critical + warning insights into the hero count', () => {
    renderSummary(
      <FleetHealthSummary
        stats={stats}
        isLoading={false}
        insightStats={insightStats}
        layout="insights-first"
      />,
    );

    // 1 unhealthy + 2 stopped containers + 14 critical + 2 warning = 19.
    expect(screen.getByTestId('needs-attention-count')).toHaveTextContent('19');
  });
});
