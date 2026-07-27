import { describe, it, expect } from 'vitest';
import {
  getForecastRiskScore,
  getForecastRiskLevel,
  hasReportableEta,
  FORECAST_ETA_BAND_FLOOR,
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

    expect(getForecastRiskScore(latestBreach)).toBeGreaterThan(FORECAST_ETA_BAND_FLOOR);
    expect(getForecastRiskScore(hottestNoEta)).toBeLessThan(FORECAST_ETA_BAND_FLOOR);
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

    expect(getForecastRiskScore(distant)).toBeGreaterThan(FORECAST_ETA_BAND_FLOOR);
  });

  it('orders unprojected rows by trend, then by current value', () => {
    const increasing = makeForecast({ trend: 'increasing', currentValue: 50 });
    const stable = makeForecast({ trend: 'stable', currentValue: 50 });
    const decreasing = makeForecast({ trend: 'decreasing', currentValue: 50 });

    expect(getForecastRiskScore(increasing)).toBeGreaterThan(getForecastRiskScore(stable));
    expect(getForecastRiskScore(stable)).toBeGreaterThan(getForecastRiskScore(decreasing));
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
