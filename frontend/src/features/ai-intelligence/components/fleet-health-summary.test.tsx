import { describe, it, expect, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { ShieldAlert, PackageOpen } from 'lucide-react';
import { FleetHealthSummary } from './fleet-health-summary';
import type { HealthStats } from '@/shared/lib/health-score';

const stats: HealthStats = {
  total: 10,
  running: 8,
  stopped: 2,
  paused: 0,
  unhealthy: 1,
  healthy: 7,
  unknown: 0,
  noHealthcheck: 0,
};

describe('FleetHealthSummary', () => {
  it('renders the four container-status tiles by default', () => {
    render(<FleetHealthSummary stats={stats} isLoading={false} />);
    const hero = screen.getByTestId('fleet-health-hero');
    expect(within(hero).getByText('Running')).toBeInTheDocument();
    expect(within(hero).getByText('Healthy')).toBeInTheDocument();
    expect(within(hero).getByText('Unhealthy')).toBeInTheDocument();
    expect(within(hero).getByText('No Healthcheck')).toBeInTheDocument();
  });

  it('does not render extra tiles when none are provided (backward compatible)', () => {
    render(<FleetHealthSummary stats={stats} isLoading={false} />);
    expect(screen.queryByText('Security Findings')).not.toBeInTheDocument();
    expect(screen.queryByText('Stopped')).not.toBeInTheDocument();
  });

  it('renders provided extraTiles after the container tiles', () => {
    render(
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
    // Non-clickable extra tiles must NOT be buttons (only onClick tiles are).
    expect(within(hero).queryByRole('button', { name: /Stopped/i })).not.toBeInTheDocument();
    expect(within(hero).queryByRole('button', { name: /Security Findings/i })).not.toBeInTheDocument();
  });

  it('renders an extraTile with onClick as a button and fires the handler', () => {
    const onClick = vi.fn();
    render(
      <FleetHealthSummary
        stats={stats}
        isLoading={false}
        statusColumns={3}
        extraTiles={[
          { icon: ShieldAlert, label: 'Security Findings', value: 4, onClick },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Security Findings/i }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('applies the requested column count to the status grid', () => {
    render(<FleetHealthSummary stats={stats} isLoading={false} statusColumns={3} />);
    const running = screen.getByText('Running');
    expect(running.closest('[class*="sm:grid-cols-3"]')).not.toBeNull();
  });
});
