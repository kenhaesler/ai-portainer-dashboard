import { describe, it, expect } from 'vitest';
import { reportScopeSubtitle } from './reports';

/**
 * The page led with "7 containers" above a 25-row table, because the header
 * counted only running containers while the table listed every container
 * observed in the window — and a right-sizing rule below it said "25
 * containers". Three numbers for one fleet, none naming its own basis.
 */
describe('reportScopeSubtitle', () => {
  it('states the split when some containers are not running', () => {
    expect(
      reportScopeSubtitle({ fleetSummary: { totalContainers: 7, totalObserved: 25 } }, '24h'),
    ).toBe('7 of 25 containers running, over the last 24 hours');
  });

  it('omits the split when every observed container is running', () => {
    // "12 of 12 running" is noise on a healthy fleet.
    expect(
      reportScopeSubtitle({ fleetSummary: { totalContainers: 12, totalObserved: 12 } }, '24h'),
    ).toBe('12 containers over the last 24 hours');
  });

  it('uses the singular for one container', () => {
    expect(
      reportScopeSubtitle({ fleetSummary: { totalContainers: 1, totalObserved: 1 } }, '24h'),
    ).toBe('1 container over the last 24 hours');
  });

  it('degrades to the running count against a server that does not send totalObserved', () => {
    expect(
      reportScopeSubtitle({ fleetSummary: { totalContainers: 4 } }, '7d'),
    ).toBe('4 containers over the last 7 days');
  });
});
