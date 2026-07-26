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

  // The UI used to hardcode "0.0.0.0" in its Host IP column because the
  // normalizer dropped Docker's `IP`. A loopback-only publish and a
  // world-facing one must not render identically.
  it('carries the host bind IP through for each published port', () => {
    const container = makeContainer({
      Ports: [
        { IP: '127.0.0.1', PrivatePort: 5432, PublicPort: 5432, Type: 'tcp' },
        { IP: '0.0.0.0', PrivatePort: 80, PublicPort: 8080, Type: 'tcp' },
      ],
    } as Partial<Container>);

    const result = normalizeContainer(container, 1, 'local');

    expect(result.ports).toEqual([
      { private: 5432, public: 5432, type: 'tcp', ip: '127.0.0.1' },
      { private: 80, public: 8080, type: 'tcp', ip: '0.0.0.0' },
    ]);
  });

  it('keeps the IPv4 and IPv6 bindings of one mapping distinguishable', () => {
    // Docker publishes these as two entries; without the IP they collapse into
    // two identical rows and the table looks broken.
    const container = makeContainer({
      Ports: [
        { IP: '0.0.0.0', PrivatePort: 80, PublicPort: 8080, Type: 'tcp' },
        { IP: '::', PrivatePort: 80, PublicPort: 8080, Type: 'tcp' },
      ],
    } as Partial<Container>);

    const result = normalizeContainer(container, 1, 'local');

    expect(result.ports.map((p) => p.ip)).toEqual(['0.0.0.0', '::']);
  });

  it('omits ip for an exposed but unpublished port', () => {
    const container = makeContainer({
      Ports: [{ PrivatePort: 9000, Type: 'tcp' }],
    } as Partial<Container>);

    const result = normalizeContainer(container, 1, 'local');

    expect(result.ports).toEqual([{ private: 9000, public: undefined, type: 'tcp' }]);
    expect(result.ports[0].ip).toBeUndefined();
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

  it('parses healthStatus "healthy" from Status string', () => {
    const result = normalizeContainer(makeContainer({ Status: 'Up 2 hours (healthy)' }), 1, 'local');
    expect(result.healthStatus).toBe('healthy');
  });

  it('parses healthStatus "unhealthy" from Status string', () => {
    const result = normalizeContainer(makeContainer({ Status: 'Up 10 minutes (unhealthy)' }), 1, 'local');
    expect(result.healthStatus).toBe('unhealthy');
  });

  it('parses healthStatus "starting" from Status string', () => {
    const result = normalizeContainer(makeContainer({ Status: 'Up 5 minutes (health: starting)' }), 1, 'local');
    expect(result.healthStatus).toBe('starting');
  });

  it('returns undefined healthStatus when no health check configured', () => {
    const result = normalizeContainer(makeContainer({ Status: 'Up 1 hour' }), 1, 'local');
    expect(result.healthStatus).toBeUndefined();
  });

  it('returns undefined healthStatus when Status is empty', () => {
    const result = normalizeContainer(makeContainer({ Status: '' }), 1, 'local');
    expect(result.healthStatus).toBeUndefined();
  });
});
