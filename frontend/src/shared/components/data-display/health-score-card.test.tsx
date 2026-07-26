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
  it('leads with an actionable count, not a percentage', () => {
    render(
      <HealthScoreCard
        stats={makeStats({ total: 5, healthy: 3, unhealthy: 1, stopped: 1, running: 4 })}
      />,
    );

    expect(screen.getByTestId('needs-attention-count')).toHaveTextContent('2');
    expect(screen.getByText('Needs attention')).toBeInTheDocument();
    expect(screen.getByTestId('needs-attention-breakdown')).toHaveTextContent('2 containers');
  });

  it('adds unacknowledged critical + warning insights to the hero count', () => {
    // The regression this exists for: the hero read "100.0%" in green with
    // "14 Critical" in the same card. The hero must be able to see the 14.
    render(
      <HealthScoreCard
        stats={makeStats({ total: 11, healthy: 11, running: 11 })}
        insightCounts={{ critical: 14, warning: 3 }}
      />,
    );

    expect(screen.getByTestId('needs-attention-count')).toHaveTextContent('17');
    expect(screen.getByTestId('needs-attention-breakdown')).toHaveTextContent(
      '17 unacknowledged insights',
    );
    // The pass rate is still 100% — and still rendered, just not as the hero.
    expect(screen.getByTestId('healthcheck-pass-rate')).toHaveTextContent('100%');
  });

  it('names the healthcheck pass rate and states its exclusion inline', () => {
    render(
      <HealthScoreCard
        stats={makeStats({ total: 13, healthy: 11, unhealthy: 0, running: 13, noHealthcheck: 2, unknown: 2 })}
      />,
    );

    const rate = screen.getByTestId('healthcheck-pass-rate');
    expect(rate).toHaveTextContent('Healthcheck pass rate');
    expect(rate).toHaveTextContent('11 of 11 containers with a healthcheck');
    expect(rate).toHaveTextContent('2 without one, excluded');
    expect(screen.queryByText(/Overall Health Score/i)).not.toBeInTheDocument();
  });

  it('renders the pass rate as a whole percent (no false precision on small fleets)', () => {
    render(
      <HealthScoreCard
        stats={makeStats({ total: 11, healthy: 10, unhealthy: 1, running: 11 })}
      />,
    );

    // 10/11 = 90.909…; "90.9%" implies a resolution 11 containers do not have.
    expect(screen.getByTestId('healthcheck-pass-rate')).toHaveTextContent('91%');
    expect(screen.getByTestId('healthcheck-pass-rate')).not.toHaveTextContent('90.9');
  });

  it('explains an unavailable pass rate instead of printing a number', () => {
    render(
      <HealthScoreCard
        stats={makeStats({ total: 3, running: 3, noHealthcheck: 3, unknown: 3 })}
      />,
    );

    expect(screen.getByTestId('healthcheck-pass-rate')).toHaveTextContent(
      /Healthcheck pass rate unavailable/,
    );
  });

  it('shows the clear state when nothing needs attention', () => {
    render(
      <HealthScoreCard
        stats={makeStats({ total: 3, healthy: 3, running: 3 })}
        insightCounts={{ critical: 0, warning: 0 }}
      />,
    );

    expect(screen.getByTestId('needs-attention-count')).toHaveTextContent('0');
    expect(screen.getByTestId('attention-icon-clear')).toBeInTheDocument();
  });

  it('uses the critical icon when a container is unhealthy and the warning icon otherwise', () => {
    const { unmount } = render(
      <HealthScoreCard stats={makeStats({ total: 2, healthy: 1, unhealthy: 1, running: 2 })} />,
    );
    expect(screen.getByTestId('attention-icon-critical')).toBeInTheDocument();
    unmount();

    render(<HealthScoreCard stats={makeStats({ total: 2, healthy: 1, stopped: 1, running: 1 })} />);
    expect(screen.getByTestId('attention-icon-warning')).toBeInTheDocument();
  });

  it('does not draw a static full-circle ring around the icon', () => {
    // `border-8 border-primary/20` read as a radial progress meter and
    // rendered identically at 100% and at 12%.
    const { container } = render(
      <HealthScoreCard stats={makeStats({ total: 2, healthy: 1, unhealthy: 1, running: 2 })} />,
    );

    expect(container.querySelector('.border-8')).toBeNull();
  });
});
