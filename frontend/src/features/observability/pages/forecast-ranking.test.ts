import { describe, it, expect } from 'vitest';
import {
  getForecastRiskScore,
  getForecastRiskLevel,
  hasReportableEta,
  FORECAST_ETA_BAND_FLOOR,
  FORECAST_NO_ETA_BAND_CEILING,
} from './metrics-dashboard';
import type { CapacityForecast } from '@/features/observability/hooks/use-forecasts';

function makeForecast(overrides: Partial<CapacityForecast> = {}): CapacityForecast {
  return {
    containerId: 'c1',
    containerName: 'svc',
    metricType: 'cpu',
    currentValue: 10,
    trend: 'increasing',
    slope: 0.5,
    r_squared: 0.9,
    forecast: [],
    timeToThreshold: null,
    confidence: 'high',
    ...overrides,
  };
}

/**
 * The "Risk-ranked" fleet table inverted its own severity column.
 *
 * The two branches of the score used incompatible scales: `200 - eta * 20` for
 * rows with an ETA (120 at four hours) against `120 + currentValue` for rows
 * without one (130.7 for a healthy container idling at 10.7%). On the live
 * fleet, `docker-backend-1` — Warning, breach in ~4h — sat at rank 10, below
 * eight rows the same table labelled Healthy.
 */
describe('forecast risk ranking', () => {
  it('ranks a four-hour breach above a healthy idling container', () => {
    const breachIn4h = makeForecast({ timeToThreshold: 4, currentValue: 30, confidence: 'high' });
    const healthyIdle = makeForecast({ timeToThreshold: null, currentValue: 10.7, trend: 'increasing' });

    expect(getForecastRiskScore(breachIn4h)).toBeGreaterThan(getForecastRiskScore(healthyIdle));
  });

  it('ranks any projected breach above every unprojected row, even at 100% current', () => {
    // The worst case for the old scale: a no-ETA row pinned at 100%.
    const latestBreach = makeForecast({ timeToThreshold: 24, confidence: 'high', currentValue: 0 });
    const hottestNoEta = makeForecast({ timeToThreshold: null, currentValue: 100, trend: 'increasing' });

    expect(getForecastRiskScore(latestBreach)).toBeGreaterThanOrEqual(FORECAST_ETA_BAND_FLOOR);
    expect(getForecastRiskScore(hottestNoEta)).toBeLessThanOrEqual(FORECAST_NO_ETA_BAND_CEILING);
    expect(getForecastRiskScore(latestBreach)).toBeGreaterThan(getForecastRiskScore(hottestNoEta));
  });

  it('orders projected breaches by how soon they are', () => {
    const soon = makeForecast({ timeToThreshold: 1 });
    const later = makeForecast({ timeToThreshold: 12 });

    expect(getForecastRiskScore(soon)).toBeGreaterThan(getForecastRiskScore(later));
  });

  it('does not sink a very distant breach below the no-ETA band', () => {
    // The old branch clamped at 0, so a breach beyond 10h ranked below
    // everything on the page.
    const distant = makeForecast({ timeToThreshold: 100 });

    expect(getForecastRiskScore(distant)).toBeGreaterThanOrEqual(FORECAST_ETA_BAND_FLOOR);
  });

  it('orders unprojected rows by trend, then by current value', () => {
    const increasing = makeForecast({ trend: 'increasing', currentValue: 50 });
    const stable = makeForecast({ trend: 'stable', currentValue: 50 });
    const decreasing = makeForecast({ trend: 'decreasing', currentValue: 50 });

    expect(getForecastRiskScore(increasing)).toBeGreaterThan(getForecastRiskScore(stable));
    expect(getForecastRiskScore(stable)).toBeGreaterThan(getForecastRiskScore(decreasing));
  });

  it('keeps trend dominant over current value, so a hot flat series cannot outrank a climbing idle one', () => {
    const climbingIdle = makeForecast({ trend: 'increasing', currentValue: 0 });
    const hotFlat = makeForecast({ trend: 'stable', currentValue: 100 });
    const hotFalling = makeForecast({ trend: 'decreasing', currentValue: 100 });

    expect(getForecastRiskScore(climbingIdle)).toBeGreaterThan(getForecastRiskScore(hotFlat));
    expect(getForecastRiskScore(makeForecast({ trend: 'stable', currentValue: 0 })))
      .toBeGreaterThan(getForecastRiskScore(hotFalling));
  });
});

/**
 * Previously nothing in the code expressed the separation: the exported
 * `FORECAST_ETA_BAND_FLOOR` was never read by the scoring function, and the
 * no-ETA branch had no lower clamp and no test asserting a lower bound.
 *
 * These score a grid of both branches and fail if the bands meet. A grid, not
 * the whole input space, but it reaches each band's extremes: the ETA branch's
 * score varies with `timeToThreshold` alone and monotonically; the no-ETA
 * branch's with `trend` (all three enumerated) and monotonically with
 * `currentValue`; and both grids run past `getForecastRiskScore`'s clamps on
 * both sides.
 */
describe('forecast risk band separation', () => {
  const TRENDS = ['increasing', 'stable', 'decreasing'] as const;

  /**
   * The ETA branch across its clamp range and past both ends.
   * `capacity-forecaster.ts:163` gates on `hoursToThreshold > 0 && < 168`, so
   * the over-range end is reachable and today's producer emits no negative ETA.
   * `getForecastRiskScore` clamps both ends, so both are sampled here.
   */
  function etaBandScores(): number[] {
    const scores: number[] = [];
    for (let hours = -12; hours <= 48; hours += 0.25) {
      for (const currentValue of [-10, 0, 50, 100, 150]) {
        for (const confidence of ['high', 'medium'] as const) {
          scores.push(
            getForecastRiskScore(
              makeForecast({ timeToThreshold: hours, confidence, currentValue }),
            ),
          );
        }
      }
    }
    return scores;
  }

  /** The no-ETA branch across all three trends, past the currentValue clamp both ways. */
  function noEtaBandScores(): number[] {
    const scores: number[] = [];
    for (const trend of TRENDS) {
      for (let currentValue = -50; currentValue <= 150; currentValue += 0.5) {
        // Both ways a row lands in this branch: no ETA at all, and an ETA the
        // confidence gate suppressed.
        scores.push(getForecastRiskScore(makeForecast({ trend, currentValue, timeToThreshold: null })));
        scores.push(
          getForecastRiskScore(
            makeForecast({ trend, currentValue, timeToThreshold: 1, confidence: 'low' }),
          ),
        );
      }
    }
    return scores;
  }

  it('leaves no score in the ETA band at or below any score in the no-ETA band', () => {
    expect(Math.min(...etaBandScores())).toBeGreaterThan(Math.max(...noEtaBandScores()));
  });

  it('keeps each band inside the bounds it publishes', () => {
    expect(Math.min(...etaBandScores())).toBeGreaterThanOrEqual(FORECAST_ETA_BAND_FLOOR);
    expect(Math.max(...noEtaBandScores())).toBeLessThanOrEqual(FORECAST_NO_ETA_BAND_CEILING);
    expect(FORECAST_NO_ETA_BAND_CEILING).toBeLessThan(FORECAST_ETA_BAND_FLOOR);
  });
});

/**
 * The band-separation grids above run past both clamps, but only in aggregate —
 * `Math.min`/`Math.max` would still pass if a negative input scored somewhere
 * harmless inside its own band. These pin the clamps themselves.
 */
describe('forecast risk score input clamps', () => {
  it('scores a negative ETA as due now, at the top of the ETA band', () => {
    const negative = makeForecast({ timeToThreshold: -6, confidence: 'high', currentValue: 95 });
    const dueNow = makeForecast({ timeToThreshold: 0, confidence: 'high', currentValue: 95 });

    expect(getForecastRiskScore(negative)).toBe(getForecastRiskScore(dueNow));
    // Top of the band, so nothing with an ETA outranks it.
    for (let hours = 0; hours <= 48; hours += 0.5) {
      expect(getForecastRiskScore(negative)).toBeGreaterThanOrEqual(
        getForecastRiskScore(makeForecast({ timeToThreshold: hours, confidence: 'high' })),
      );
    }
  });

  it('does not let an over-range ETA fall out of the bottom of its band', () => {
    const far = makeForecast({ timeToThreshold: 10_000, confidence: 'high' });

    expect(getForecastRiskScore(far)).toBe(FORECAST_ETA_BAND_FLOOR);
  });

  it('clamps a negative currentValue to the floor of its trend slot', () => {
    const negative = makeForecast({ trend: 'stable', currentValue: -250, timeToThreshold: null });
    const zero = makeForecast({ trend: 'stable', currentValue: 0, timeToThreshold: null });
    const decreasingAtZero = makeForecast({ trend: 'decreasing', currentValue: 0, timeToThreshold: null });

    expect(getForecastRiskScore(negative)).toBe(getForecastRiskScore(zero));
    // Unclamped, a reading that far negative drags a stable row below the
    // decreasing slot and out of the bottom of the band.
    expect(getForecastRiskScore(negative)).toBeGreaterThan(getForecastRiskScore(decreasingAtZero));
    expect(getForecastRiskScore(negative)).toBeGreaterThanOrEqual(0);
  });

  it('clamps an over-100 currentValue to the top of its trend slot, not into the next one', () => {
    const over = makeForecast({ trend: 'stable', currentValue: 400, timeToThreshold: null });
    const full = makeForecast({ trend: 'stable', currentValue: 100, timeToThreshold: null });
    const increasingAtZero = makeForecast({ trend: 'increasing', currentValue: 0, timeToThreshold: null });

    expect(getForecastRiskScore(over)).toBe(getForecastRiskScore(full));
    // Unclamped, 400 lifts a stable row past the increasing slot above it and
    // past the band's own published ceiling.
    expect(getForecastRiskScore(over)).toBeLessThan(getForecastRiskScore(increasingAtZero));
    expect(getForecastRiskScore(over)).toBeLessThanOrEqual(FORECAST_NO_ETA_BAND_CEILING);
  });
});

/**
 * `capacity-forecaster.ts` divides `(90 - currentValue) / slope` with no
 * goodness-of-fit gate, so a weak fit over a past spike produced a hard ETA.
 * The live fleet's top-ranked risk was a container at 0.0% CPU said to breach
 * in about an hour.
 */
describe('forecast ETA confidence gate', () => {
  it('suppresses an ETA from a low-confidence fit', () => {
    const weak = makeForecast({ timeToThreshold: 1, confidence: 'low', currentValue: 0 });

    expect(hasReportableEta(weak)).toBe(false);
    expect(getForecastRiskLevel(weak)).toBe('healthy');
  });

  it('does not let a low-confidence ETA claim the top of the ranking', () => {
    const weakButImminent = makeForecast({ timeToThreshold: 1, confidence: 'low', currentValue: 0 });
    const solidButLater = makeForecast({ timeToThreshold: 8, confidence: 'high', currentValue: 60 });

    expect(getForecastRiskScore(solidButLater)).toBeGreaterThan(getForecastRiskScore(weakButImminent));
  });

  it('keeps a medium-confidence ETA — the gate drops only the unusable fits', () => {
    const medium = makeForecast({ timeToThreshold: 1, confidence: 'medium' });

    expect(hasReportableEta(medium)).toBe(true);
    expect(getForecastRiskLevel(medium)).toBe('critical');
  });

  it('reports no ETA at all as unprojected rather than low confidence', () => {
    expect(hasReportableEta(makeForecast({ timeToThreshold: null, confidence: 'high' }))).toBe(false);
  });
});
