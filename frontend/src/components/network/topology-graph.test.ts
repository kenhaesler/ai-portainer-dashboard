import { describe, it, expect } from 'vitest';
import {
  getEdgeStyle,
  getStatePriority,
  getContainerTraffic,
  sortContainers,
  sortInlineNetworks,
  computeNetworkMedianY,
  hasUnhealthyContainers,
  getStackTraffic,
  sortStacks,
  type ContainerData,
  type NetworkData,
} from './topology-graph';

describe('getEdgeStyle', () => {
  it('returns gray/thin for stopped containers', () => {
    const rates = { c1: { rxBytesPerSec: 500_000, txBytesPerSec: 500_000 } };
    const style = getEdgeStyle('c1', 'stopped', rates);
    expect(style.stroke).toBe('#6b7280');
    expect(style.strokeWidth).toBe(1.5);
  });

  it('returns gray/thin when no rates data', () => {
    const style = getEdgeStyle('c1', 'running', undefined);
    expect(style.stroke).toBe('#6b7280');
    expect(style.strokeWidth).toBe(1.5);
  });

  it('returns gray/thin when container has no rate entry', () => {
    const rates = { other: { rxBytesPerSec: 1000, txBytesPerSec: 1000 } };
    const style = getEdgeStyle('c1', 'running', rates);
    expect(style.stroke).toBe('#6b7280');
    expect(style.strokeWidth).toBe(1.5);
  });

  it('returns gray/thin for zero traffic', () => {
    const rates = { c1: { rxBytesPerSec: 0, txBytesPerSec: 0 } };
    const style = getEdgeStyle('c1', 'running', rates);
    expect(style.stroke).toBe('#6b7280');
    expect(style.strokeWidth).toBe(1.5);
  });

  it('returns green for low traffic (< 10 KB/s)', () => {
    const rates = { c1: { rxBytesPerSec: 3000, txBytesPerSec: 2000 } }; // 5 KB/s total
    const style = getEdgeStyle('c1', 'running', rates);
    expect(style.stroke).toBe('#10b981');
    expect(style.strokeWidth).toBe(2);
  });

  it('returns yellow for medium traffic (< 100 KB/s)', () => {
    const rates = { c1: { rxBytesPerSec: 30_000, txBytesPerSec: 20_000 } }; // 50 KB/s total
    const style = getEdgeStyle('c1', 'running', rates);
    expect(style.stroke).toBe('#eab308');
    expect(style.strokeWidth).toBe(3);
  });

  it('returns orange for high traffic (< 1 MB/s)', () => {
    const rates = { c1: { rxBytesPerSec: 300_000, txBytesPerSec: 200_000 } }; // 500 KB/s total
    const style = getEdgeStyle('c1', 'running', rates);
    expect(style.stroke).toBe('#f97316');
    expect(style.strokeWidth).toBe(4);
  });

  it('returns red for very high traffic (>= 1 MB/s)', () => {
    const rates = { c1: { rxBytesPerSec: 600_000, txBytesPerSec: 600_000 } }; // 1.2 MB/s total
    const style = getEdgeStyle('c1', 'running', rates);
    expect(style.stroke).toBe('#ef4444');
    expect(style.strokeWidth).toBe(6);
  });

  it('handles boundary at exactly 10 KB/s (10240 bytes)', () => {
    const rates = { c1: { rxBytesPerSec: 10_240, txBytesPerSec: 0 } };
    const style = getEdgeStyle('c1', 'running', rates);
    expect(style.stroke).toBe('#eab308'); // yellow, >= 10KB threshold
    expect(style.strokeWidth).toBe(3);
  });

  it('handles boundary at exactly 1 MB/s (1048576 bytes)', () => {
    const rates = { c1: { rxBytesPerSec: 1_048_576, txBytesPerSec: 0 } };
    const style = getEdgeStyle('c1', 'running', rates);
    expect(style.stroke).toBe('#ef4444'); // red, >= 1MB threshold
    expect(style.strokeWidth).toBe(6);
  });
});

// --- Helper to build ContainerData for tests ---
function makeContainer(overrides: Partial<ContainerData> & { id: string; name: string }): ContainerData {
  return {
    state: 'running',
    image: 'test:latest',
    networks: [],
    labels: {},
    ...overrides,
  };
}

function makeNetwork(overrides: Partial<NetworkData> & { id: string; name: string }): NetworkData {
  return {
    containers: [],
    ...overrides,
  };
}

// --- getStatePriority ---
describe('getStatePriority', () => {
  it('returns 0 for running', () => {
    expect(getStatePriority('running')).toBe(0);
  });

  it('returns 1 for paused', () => {
    expect(getStatePriority('paused')).toBe(1);
  });

  it('returns 2 for stopped', () => {
    expect(getStatePriority('stopped')).toBe(2);
  });

  it('returns 3 for unknown', () => {
    expect(getStatePriority('unknown')).toBe(3);
  });

  it('returns 3 for unrecognised state', () => {
    expect(getStatePriority('restarting')).toBe(3);
  });
});

// --- getContainerTraffic ---
describe('getContainerTraffic', () => {
  it('returns sum of rx+tx when present', () => {
    const rates = { c1: { rxBytesPerSec: 100, txBytesPerSec: 200 } };
    expect(getContainerTraffic('c1', rates)).toBe(300);
  });

  it('returns 0 when container not in rates', () => {
    const rates = { other: { rxBytesPerSec: 100, txBytesPerSec: 200 } };
    expect(getContainerTraffic('c1', rates)).toBe(0);
  });

  it('returns 0 when networkRates is undefined', () => {
    expect(getContainerTraffic('c1', undefined)).toBe(0);
  });

  it('returns 0 when both rx and tx are zero', () => {
    const rates = { c1: { rxBytesPerSec: 0, txBytesPerSec: 0 } };
    expect(getContainerTraffic('c1', rates)).toBe(0);
  });
});

// --- sortContainers ---
describe('sortContainers', () => {
  it('sorts by state priority (running before stopped)', () => {
    const containers = [
      makeContainer({ id: 'c1', name: 'alpha', state: 'stopped' }),
      makeContainer({ id: 'c2', name: 'bravo', state: 'running' }),
    ];
    const sorted = sortContainers(containers);
    expect(sorted.map(c => c.id)).toEqual(['c2', 'c1']);
  });

  it('sorts by traffic desc within same state', () => {
    const containers = [
      makeContainer({ id: 'c1', name: 'alpha', state: 'running' }),
      makeContainer({ id: 'c2', name: 'bravo', state: 'running' }),
    ];
    const rates = {
      c1: { rxBytesPerSec: 100, txBytesPerSec: 0 },
      c2: { rxBytesPerSec: 500, txBytesPerSec: 500 },
    };
    const sorted = sortContainers(containers, rates);
    expect(sorted.map(c => c.id)).toEqual(['c2', 'c1']);
  });

  it('sorts by name asc as final tiebreaker', () => {
    const containers = [
      makeContainer({ id: 'c1', name: 'zebra', state: 'running' }),
      makeContainer({ id: 'c2', name: 'alpha', state: 'running' }),
    ];
    const sorted = sortContainers(containers);
    expect(sorted.map(c => c.name)).toEqual(['alpha', 'zebra']);
  });

  it('does not mutate the original array', () => {
    const containers = [
      makeContainer({ id: 'c1', name: 'bravo', state: 'stopped' }),
      makeContainer({ id: 'c2', name: 'alpha', state: 'running' }),
    ];
    const sorted = sortContainers(containers);
    expect(sorted).not.toBe(containers);
    expect(containers[0].id).toBe('c1'); // original unchanged
  });

  it('handles all states together', () => {
    const containers = [
      makeContainer({ id: 'c1', name: 'a', state: 'unknown' }),
      makeContainer({ id: 'c2', name: 'b', state: 'running' }),
      makeContainer({ id: 'c3', name: 'c', state: 'stopped' }),
      makeContainer({ id: 'c4', name: 'd', state: 'paused' }),
    ];
    const sorted = sortContainers(containers);
    expect(sorted.map(c => c.state)).toEqual(['running', 'paused', 'stopped', 'unknown']);
  });
});

// --- sortInlineNetworks ---
describe('sortInlineNetworks', () => {
  it('sorts by connected container count desc', () => {
    const nets = [
      makeNetwork({ id: 'n1', name: 'net-a', containers: ['c1'] }),
      makeNetwork({ id: 'n2', name: 'net-b', containers: ['c1', 'c2', 'c3'] }),
    ];
    const sorted = sortInlineNetworks(nets, ['c1', 'c2', 'c3']);
    expect(sorted.map(n => n.id)).toEqual(['n2', 'n1']);
  });

  it('only counts containers in the stack', () => {
    const nets = [
      makeNetwork({ id: 'n1', name: 'net-a', containers: ['c1', 'c2', 'c99'] }),
      makeNetwork({ id: 'n2', name: 'net-b', containers: ['c1', 'c2'] }),
    ];
    // c99 is not in the stack, so n1 has 2 matches (same as n2) — tie broken by name
    const sorted = sortInlineNetworks(nets, ['c1', 'c2']);
    expect(sorted.map(n => n.id)).toEqual(['n1', 'n2']); // tie on 2, net-a < net-b
  });

  it('sorts by name asc as tiebreaker', () => {
    const nets = [
      makeNetwork({ id: 'n1', name: 'zebra-net', containers: ['c1'] }),
      makeNetwork({ id: 'n2', name: 'alpha-net', containers: ['c1'] }),
    ];
    const sorted = sortInlineNetworks(nets, ['c1']);
    expect(sorted.map(n => n.name)).toEqual(['alpha-net', 'zebra-net']);
  });

  it('does not mutate the original array', () => {
    const nets = [
      makeNetwork({ id: 'n1', name: 'b-net', containers: [] }),
      makeNetwork({ id: 'n2', name: 'a-net', containers: ['c1'] }),
    ];
    const sorted = sortInlineNetworks(nets, ['c1']);
    expect(sorted).not.toBe(nets);
  });
});

// --- computeNetworkMedianY ---
describe('computeNetworkMedianY', () => {
  it('returns median Y for odd number of containers', () => {
    const net = makeNetwork({ id: 'n1', name: 'net', containers: ['c1', 'c2', 'c3'] });
    const positions = new Map([['c1', 100], ['c2', 200], ['c3', 300]]);
    expect(computeNetworkMedianY(net, positions)).toBe(200);
  });

  it('returns average of middle two for even number of containers', () => {
    const net = makeNetwork({ id: 'n1', name: 'net', containers: ['c1', 'c2', 'c3', 'c4'] });
    const positions = new Map([['c1', 100], ['c2', 200], ['c3', 300], ['c4', 400]]);
    expect(computeNetworkMedianY(net, positions)).toBe(250);
  });

  it('returns 0 for network with no positioned containers', () => {
    const net = makeNetwork({ id: 'n1', name: 'net', containers: ['c99'] });
    const positions = new Map<string, number>();
    expect(computeNetworkMedianY(net, positions)).toBe(0);
  });

  it('returns 0 for network with no containers at all', () => {
    const net = makeNetwork({ id: 'n1', name: 'net', containers: [] });
    const positions = new Map<string, number>();
    expect(computeNetworkMedianY(net, positions)).toBe(0);
  });

  it('returns the single Y for one container', () => {
    const net = makeNetwork({ id: 'n1', name: 'net', containers: ['c1'] });
    const positions = new Map([['c1', 150]]);
    expect(computeNetworkMedianY(net, positions)).toBe(150);
  });

  it('ignores containers not in positions map', () => {
    const net = makeNetwork({ id: 'n1', name: 'net', containers: ['c1', 'c2', 'missing'] });
    const positions = new Map([['c1', 100], ['c2', 300]]);
    expect(computeNetworkMedianY(net, positions)).toBe(200); // avg of 100, 300
  });
});

// --- hasUnhealthyContainers ---
describe('hasUnhealthyContainers', () => {
  it('returns false for all running', () => {
    const containers = [
      makeContainer({ id: 'c1', name: 'a', state: 'running' }),
      makeContainer({ id: 'c2', name: 'b', state: 'running' }),
    ];
    expect(hasUnhealthyContainers(containers)).toBe(false);
  });

  it('returns true if any stopped', () => {
    const containers = [
      makeContainer({ id: 'c1', name: 'a', state: 'running' }),
      makeContainer({ id: 'c2', name: 'b', state: 'stopped' }),
    ];
    expect(hasUnhealthyContainers(containers)).toBe(true);
  });

  it('returns true if any paused', () => {
    const containers = [
      makeContainer({ id: 'c1', name: 'a', state: 'paused' }),
    ];
    expect(hasUnhealthyContainers(containers)).toBe(true);
  });

  it('returns false for empty array', () => {
    expect(hasUnhealthyContainers([])).toBe(false);
  });

  it('returns false for unknown state (not stopped/paused)', () => {
    const containers = [
      makeContainer({ id: 'c1', name: 'a', state: 'unknown' }),
    ];
    expect(hasUnhealthyContainers(containers)).toBe(false);
  });
});

// --- getStackTraffic ---
describe('getStackTraffic', () => {
  it('sums traffic of all containers', () => {
    const containers = [
      makeContainer({ id: 'c1', name: 'a' }),
      makeContainer({ id: 'c2', name: 'b' }),
    ];
    const rates = {
      c1: { rxBytesPerSec: 100, txBytesPerSec: 50 },
      c2: { rxBytesPerSec: 200, txBytesPerSec: 100 },
    };
    expect(getStackTraffic(containers, rates)).toBe(450);
  });

  it('returns 0 when no rates', () => {
    const containers = [makeContainer({ id: 'c1', name: 'a' })];
    expect(getStackTraffic(containers, undefined)).toBe(0);
  });

  it('returns 0 for empty containers', () => {
    expect(getStackTraffic([], { c1: { rxBytesPerSec: 100, txBytesPerSec: 0 } })).toBe(0);
  });
});

// --- sortStacks ---
describe('sortStacks', () => {
  it('places Standalone last', () => {
    const stackMap = new Map<string, ContainerData[]>([
      ['Standalone', [makeContainer({ id: 'c1', name: 'a' })]],
      ['alpha', [makeContainer({ id: 'c2', name: 'b' })]],
    ]);
    const sorted = sortStacks(['Standalone', 'alpha'], stackMap);
    expect(sorted).toEqual(['alpha', 'Standalone']);
  });

  it('surfaces stacks with unhealthy containers first', () => {
    const stackMap = new Map<string, ContainerData[]>([
      ['healthy-stack', [makeContainer({ id: 'c1', name: 'a', state: 'running' })]],
      ['sick-stack', [makeContainer({ id: 'c2', name: 'b', state: 'stopped' })]],
    ]);
    const sorted = sortStacks(['healthy-stack', 'sick-stack'], stackMap);
    expect(sorted).toEqual(['sick-stack', 'healthy-stack']);
  });

  it('sorts by traffic desc among healthy stacks', () => {
    const stackMap = new Map<string, ContainerData[]>([
      ['low-traffic', [makeContainer({ id: 'c1', name: 'a' })]],
      ['high-traffic', [makeContainer({ id: 'c2', name: 'b' })]],
    ]);
    const rates = {
      c1: { rxBytesPerSec: 10, txBytesPerSec: 0 },
      c2: { rxBytesPerSec: 10_000, txBytesPerSec: 5_000 },
    };
    const sorted = sortStacks(['low-traffic', 'high-traffic'], stackMap, rates);
    expect(sorted).toEqual(['high-traffic', 'low-traffic']);
  });

  it('sorts by container count desc as tiebreaker', () => {
    const stackMap = new Map<string, ContainerData[]>([
      ['small', [makeContainer({ id: 'c1', name: 'a' })]],
      ['big', [
        makeContainer({ id: 'c2', name: 'b' }),
        makeContainer({ id: 'c3', name: 'c' }),
        makeContainer({ id: 'c4', name: 'd' }),
      ]],
    ]);
    const sorted = sortStacks(['small', 'big'], stackMap);
    expect(sorted).toEqual(['big', 'small']);
  });

  it('sorts by name asc as final tiebreaker', () => {
    const stackMap = new Map<string, ContainerData[]>([
      ['zebra', [makeContainer({ id: 'c1', name: 'a' })]],
      ['alpha', [makeContainer({ id: 'c2', name: 'b' })]],
    ]);
    const sorted = sortStacks(['zebra', 'alpha'], stackMap);
    expect(sorted).toEqual(['alpha', 'zebra']);
  });

  it('does not mutate the original array', () => {
    const stackMap = new Map<string, ContainerData[]>([
      ['b', [makeContainer({ id: 'c1', name: 'a' })]],
      ['a', [makeContainer({ id: 'c2', name: 'b' })]],
    ]);
    const names = ['b', 'a'];
    const sorted = sortStacks(names, stackMap);
    expect(sorted).not.toBe(names);
    expect(names).toEqual(['b', 'a']); // original unchanged
  });

  it('combines all criteria correctly', () => {
    const stackMap = new Map<string, ContainerData[]>([
      ['Standalone', [makeContainer({ id: 'c5', name: 'e' })]],
      ['healthy-busy', [makeContainer({ id: 'c1', name: 'a' })]],
      ['healthy-quiet', [makeContainer({ id: 'c2', name: 'b' })]],
      ['sick-stack', [makeContainer({ id: 'c3', name: 'c', state: 'stopped' })]],
    ]);
    const rates = {
      c1: { rxBytesPerSec: 5000, txBytesPerSec: 5000 },
      c2: { rxBytesPerSec: 10, txBytesPerSec: 0 },
      c3: { rxBytesPerSec: 0, txBytesPerSec: 0 },
      c5: { rxBytesPerSec: 0, txBytesPerSec: 0 },
    };
    const sorted = sortStacks(
      ['Standalone', 'healthy-busy', 'healthy-quiet', 'sick-stack'],
      stackMap,
      rates,
    );
    // sick first, then busy, then quiet, Standalone last
    expect(sorted).toEqual(['sick-stack', 'healthy-busy', 'healthy-quiet', 'Standalone']);
  });
});
