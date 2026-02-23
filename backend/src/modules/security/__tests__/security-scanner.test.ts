import { describe, expect, it } from 'vitest';
import { scanCapabilityPosture } from '../services/security-scanner.js';
import type { Container } from '../../../core/models/portainer.js';

function makeContainer(overrides: Partial<Container> = {}): Container {
  return {
    Id: 'abc1234567890',
    Names: ['/api'],
    Image: 'api:latest',
    Created: 1,
    State: 'running',
    Status: 'Up 1 minute',
    Ports: [],
    Labels: {},
    NetworkSettings: { Networks: {} },
    HostConfig: {
      Privileged: false,
      CapAdd: [],
      NetworkMode: 'bridge',
      PidMode: 'private',
    },
    ...overrides,
  } as Container;
}

describe('scanCapabilityPosture', () => {
  it('adds cap-drop-missing finding when capabilities are added', () => {
    const container = makeContainer({
      HostConfig: {
        Privileged: false,
        CapAdd: ['NET_ADMIN'],
        NetworkMode: 'bridge',
        PidMode: 'private',
      },
    });

    const findings = scanCapabilityPosture(container);

    expect(findings.some((f) => f.category === 'cap-drop-missing')).toBe(true);
    expect(findings.some((f) => f.category === 'dangerous-capability')).toBe(true);
  });

  it('marks privileged containers as critical and infers cap-drop hardening gap', () => {
    const container = makeContainer({
      HostConfig: {
        Privileged: true,
        CapAdd: [],
        NetworkMode: 'bridge',
        PidMode: 'private',
      },
    });

    const findings = scanCapabilityPosture(container);

    const privileged = findings.find((f) => f.category === 'privileged-mode');
    const capDrop = findings.find((f) => f.category === 'cap-drop-missing');

    expect(privileged?.severity).toBe('critical');
    expect(capDrop?.severity).toBe('critical');
  });
});
