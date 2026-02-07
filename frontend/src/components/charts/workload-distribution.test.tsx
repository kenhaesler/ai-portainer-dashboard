import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WorkloadDistribution, prepareWorkloadAggregate, prepareWorkloadChartData } from './workload-distribution';

describe('prepareWorkloadChartData', () => {
  it('sorts endpoints by total workload descending and computes totals', () => {
    const result = prepareWorkloadChartData([
      { endpoint: 'endpoint-02', containers: 0, running: 2, stopped: 1 },
      { endpoint: 'endpoint-01', containers: 0, running: 8, stopped: 1 },
      { endpoint: 'endpoint-03', containers: 0, running: 0, stopped: 0 },
    ]);

    expect(result.map((item) => item.endpoint)).toEqual([
      'endpoint-01',
      'endpoint-02',
      'endpoint-03',
    ]);
    expect(result.map((item) => item.total)).toEqual([9, 3, 0]);
  });

  it('truncates long endpoint labels for chart display', () => {
    const result = prepareWorkloadChartData([
      { endpoint: 'endpoint-super-long-name-abcdef', containers: 0, running: 3, stopped: 2 },
    ]);

    expect(result[0].displayName).toBe('endpoint-super-l…');
  });
});

describe('WorkloadDistribution', () => {
  it('computes aggregate totals and top contributors', () => {
    const aggregate = prepareWorkloadAggregate([
      { endpoint: 'endpoint-01', containers: 0, running: 7, stopped: 3 },
      { endpoint: 'endpoint-02', containers: 0, running: 8, stopped: 2 },
      { endpoint: 'endpoint-03', containers: 0, running: 2, stopped: 1 },
      { endpoint: 'endpoint-04', containers: 0, running: 1, stopped: 0 },
    ]);

    expect(aggregate.endpoints).toBe(4);
    expect(aggregate.totalContainers).toBe(24);
    expect(aggregate.runningPct).toBe(75);
    expect(aggregate.stoppedPct).toBe(25);
    expect(aggregate.topContributors.map((item) => item.endpoint)).toEqual([
      'endpoint-01',
      'endpoint-02',
      'endpoint-03',
    ]);
  });

  it('renders empty state when no data is available', () => {
    render(<WorkloadDistribution data={[]} />);
    expect(screen.getByText('No workload data')).toBeInTheDocument();
  });
});
