import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HealthScoreCard } from './health-score-card';
import type { HealthStats } from '@/shared/lib/health-score';

function makeStats(overrides: Partial<HealthStats> = {}): HealthStats {
  return {
    total: 0,
    running: 0,
    stopped: 0,
    paused: 0,
    healthy: 0,
    unhealthy: 0,
    unknown: 0,
    noHealthcheck: 0,
    ...overrides,
  };
}

describe('HealthScoreCard', () => {
  it('renders the score and green icon when ≥80%', () => {
    render(
      <HealthScoreCard
        stats={makeStats({ total: 10, healthy: 9, unhealthy: 1, running: 10 })}
      />,
    );

    expect(screen.getByTestId('health-score')).toHaveTextContent('90.0%');
    expect(screen.getByTestId('health-score-icon-green')).toBeInTheDocument();
    expect(screen.getByText('9 of 10 reporting healthy')).toBeInTheDocument();
  });

  it('renders the amber icon between 50% and 80%', () => {
    render(
      <HealthScoreCard
        stats={makeStats({ total: 4, healthy: 2, unhealthy: 2, running: 4 })}
      />,
    );

    expect(screen.getByTestId('health-score-icon-amber')).toBeInTheDocument();
  });

  it('renders the red icon when below 50%', () => {
    render(
      <HealthScoreCard
        stats={makeStats({ total: 4, healthy: 1, unhealthy: 3, running: 4 })}
      />,
    );

    expect(screen.getByTestId('health-score-icon-red')).toBeInTheDocument();
  });

  it('renders the "no healthchecks configured" gray state when score is null', () => {
    render(
      <HealthScoreCard
        stats={makeStats({ total: 3, running: 3, noHealthcheck: 3, unknown: 3 })}
      />,
    );

    expect(screen.getByTestId('health-score-na')).toHaveTextContent(
      'No healthchecks configured',
    );
    expect(
      screen.getByText(/3 containers tracked\. Configure Docker healthchecks/),
    ).toBeInTheDocument();
  });

  it('surfaces "needs attention" when there are unhealthy or stopped containers', () => {
    render(
      <HealthScoreCard
        stats={makeStats({ total: 5, healthy: 3, unhealthy: 1, stopped: 1, running: 4 })}
      />,
    );

    // 1 unhealthy + 1 stopped = 2 issues
    expect(screen.getByText(/2 containers need attention/)).toBeInTheDocument();
  });

  it('appends "N without healthcheck" suffix when running containers lack a healthcheck', () => {
    render(
      <HealthScoreCard
        stats={makeStats({
          total: 5,
          healthy: 3,
          unhealthy: 0,
          running: 5,
          noHealthcheck: 2,
          unknown: 2,
        })}
      />,
    );

    expect(
      screen.getByText(/3 of 3 reporting healthy · 2 without healthcheck/),
    ).toBeInTheDocument();
  });
});
