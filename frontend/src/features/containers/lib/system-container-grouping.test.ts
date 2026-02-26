import { describe, expect, it } from 'vitest';
import { getContainerGroup, getContainerGroupLabel } from './system-container-grouping';

describe('system-container-grouping', () => {
  it('classifies beyla containers as system by image', () => {
    const group = getContainerGroup({
      name: 'beyla',
      image: 'grafana/beyla:latest',
      labels: {},
    });

    expect(group).toBe('system');
  });

  it('classifies edge agent containers as system by name', () => {
    const group = getContainerGroup({
      name: 'portainer-edge-agent',
      image: 'portainer/agent:latest',
      labels: {},
    });

    expect(group).toBe('system');
  });

  it('classifies general app containers as workload', () => {
    const group = getContainerGroup({
      name: 'api-gateway',
      image: 'ghcr.io/company/api:1.0.0',
      labels: { 'com.docker.compose.project': 'payments' },
    });

    expect(group).toBe('workload');
    expect(getContainerGroupLabel({
      name: 'api-gateway',
      image: 'ghcr.io/company/api:1.0.0',
      labels: { 'com.docker.compose.project': 'payments' },
    })).toBe('Workload');
  });
});
