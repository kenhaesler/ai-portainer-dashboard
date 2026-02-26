import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FleetSummaryCard, computeFleetSummary } from './fleet-summary-card';

function makeEndpoint(name: string, running: number, stopped: number) {
  return { name, running, stopped, total: running + stopped };
}

describe('computeFleetSummary', () => {
  it('returns zeros for empty input', () => {
    const result = computeFleetSummary([], 0);
    expect(result.totalEndpoints).toBe(0);
    expect(result.totalContainers).toBe(0);
    expect(result.runningPct).toBe(0);
    expect(result.stoppedPct).toBe(0);
    expect(result.topContributors).toEqual([]);
  });

  it('computes correct percentages', () => {
    const endpoints = [
      makeEndpoint('A', 7, 3),
      makeEndpoint('B', 5, 5),
    ];
    const result = computeFleetSummary(endpoints, 20);
    expect(result.runningPct).toBe(60); // 12/20
    expect(result.stoppedPct).toBe(40);
  });

  it('selects top 3 contributors by total', () => {
    const endpoints = [
      makeEndpoint('Small', 2, 1),
      makeEndpoint('Big', 20, 5),
      makeEndpoint('Medium', 10, 3),
      makeEndpoint('Tiny', 1, 0),
    ];
    const total = endpoints.reduce((s, ep) => s + ep.total, 0);
    const result = computeFleetSummary(endpoints, total);
    expect(result.topContributors).toHaveLength(3);
    expect(result.topContributors[0].name).toBe('Big');
    expect(result.topContributors[1].name).toBe('Medium');
    expect(result.topContributors[2].name).toBe('Small');
  });

  it('handles single endpoint', () => {
    const endpoints = [makeEndpoint('Solo', 10, 0)];
    const result = computeFleetSummary(endpoints, 10);
    expect(result.runningPct).toBe(100);
    expect(result.stoppedPct).toBe(0);
    expect(result.topContributors).toHaveLength(1);
    expect(result.topContributors[0].share).toBe(100);
  });
});

describe('FleetSummaryCard', () => {
  it('renders loading state', () => {
    render(<FleetSummaryCard endpoints={[]} totalContainers={0} isLoading />);
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('renders stats for sample data', () => {
    const endpoints = [
      makeEndpoint('Production', 15, 3),
      makeEndpoint('Staging', 8, 2),
      makeEndpoint('Dev', 4, 1),
    ];
    render(<FleetSummaryCard endpoints={endpoints} totalContainers={33} />);

    // Stat pills
    expect(screen.getByText('3')).toBeInTheDocument(); // 3 endpoints
    expect(screen.getByText('33')).toBeInTheDocument(); // 33 containers
    expect(screen.getByText('Endpoints')).toBeInTheDocument();
    expect(screen.getByText('Containers')).toBeInTheDocument();

    // Percentages (27 running / 33 total = 82%)
    expect(screen.getByText('82% running')).toBeInTheDocument();
    expect(screen.getByText('18% stopped')).toBeInTheDocument();

    // Top contributors
    expect(screen.getByText('Top Contributors')).toBeInTheDocument();
    expect(screen.getByText('Production')).toBeInTheDocument();
    expect(screen.getByText('Staging')).toBeInTheDocument();
    expect(screen.getByText('Dev')).toBeInTheDocument();
  });

  it('renders with zero containers', () => {
    render(<FleetSummaryCard endpoints={[]} totalContainers={0} />);
    const zeros = screen.getAllByText('0');
    expect(zeros.length).toBeGreaterThanOrEqual(2); // endpoints + containers
    expect(screen.getByText('Endpoints')).toBeInTheDocument();
    expect(screen.getByText('Containers')).toBeInTheDocument();
  });
});
