import { describe, it, expect } from 'vitest';
import { normalizeContainer } from './portainer-normalizers.js';
import type { Container } from '../models/portainer.js';

function makeContainer(overrides: Partial<Container> = {}): Container {
  return {
    Id: 'abc123def456',
    Names: ['/my-container'],
    Image: 'nginx:latest',
    ImageID: 'sha256:abc',
    Created: 1700000000,
    State: 'running',
    Status: 'Up 2 hours',
    Ports: [],
    Labels: {},
    Mounts: [],
    ...overrides,
  } as Container;
}

describe('normalizeContainer', () => {
  it('extracts networkIPs from NetworkSettings.Networks', () => {
    const container = makeContainer({
      NetworkSettings: {
        Networks: {
          bridge: { IPAddress: '172.17.0.2', NetworkID: 'net1', Gateway: '172.17.0.1' },
          custom_net: { IPAddress: '10.0.1.5', NetworkID: 'net2', Gateway: '10.0.1.1' },
        },
      },
    });

    const result = normalizeContainer(container, 1, 'local');

    expect(result.networkIPs).toEqual({
      bridge: '172.17.0.2',
      custom_net: '10.0.1.5',
    });
    expect(result.networks).toEqual(['bridge', 'custom_net']);
  });

  it('returns empty networkIPs when no networks exist', () => {
    const container = makeContainer({
      NetworkSettings: undefined,
    });

    const result = normalizeContainer(container, 1, 'local');

    expect(result.networkIPs).toEqual({});
    expect(result.networks).toEqual([]);
  });

  it('returns empty networkIPs when Networks is empty', () => {
    const container = makeContainer({
      NetworkSettings: { Networks: {} },
    });

    const result = normalizeContainer(container, 1, 'local');

    expect(result.networkIPs).toEqual({});
    expect(result.networks).toEqual([]);
  });

  it('skips networks with empty IPAddress', () => {
    const container = makeContainer({
      NetworkSettings: {
        Networks: {
          bridge: { IPAddress: '172.17.0.2', NetworkID: 'net1' },
          no_ip: { IPAddress: '', NetworkID: 'net2' },
          also_no_ip: { NetworkID: 'net3' },
        },
      },
    });

    const result = normalizeContainer(container, 1, 'local');

    expect(result.networkIPs).toEqual({
      bridge: '172.17.0.2',
    });
    expect(result.networks).toEqual(['bridge', 'no_ip', 'also_no_ip']);
  });

  it('extracts single network IP', () => {
    const container = makeContainer({
      NetworkSettings: {
        Networks: {
          my_network: { IPAddress: '192.168.1.100', NetworkID: 'net1' },
        },
      },
    });

    const result = normalizeContainer(container, 2, 'remote');

    expect(result.networkIPs).toEqual({ my_network: '192.168.1.100' });
    expect(result.networks).toEqual(['my_network']);
    expect(result.endpointId).toBe(2);
    expect(result.endpointName).toBe('remote');
  });

  it('normalizes container name by stripping leading slash', () => {
    const container = makeContainer({ Names: ['/web-server'] });
    const result = normalizeContainer(container, 1, 'local');
    expect(result.name).toBe('web-server');
  });

  it('maps container states correctly', () => {
    expect(normalizeContainer(makeContainer({ State: 'running' }), 1, 'local').state).toBe('running');
    expect(normalizeContainer(makeContainer({ State: 'exited' }), 1, 'local').state).toBe('stopped');
    expect(normalizeContainer(makeContainer({ State: 'paused' }), 1, 'local').state).toBe('paused');
    expect(normalizeContainer(makeContainer({ State: 'dead' }), 1, 'local').state).toBe('dead');
    expect(normalizeContainer(makeContainer({ State: 'created' }), 1, 'local').state).toBe('unknown');
  });
});
