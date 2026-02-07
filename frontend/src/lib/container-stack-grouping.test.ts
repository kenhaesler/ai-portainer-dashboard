import { describe, it, expect } from 'vitest';
import { buildStackGroupedContainerOptions } from './container-stack-grouping';

describe('buildStackGroupedContainerOptions', () => {
  it('groups by stack labels and appends No Stack group last', () => {
    const result = buildStackGroupedContainerOptions([
      {
        id: '1',
        name: 'api',
        labels: { 'com.docker.compose.project': 'alpha' },
      },
      {
        id: '2',
        name: 'worker',
        labels: { 'com.docker.stack.namespace': 'beta' },
      },
      {
        id: '3',
        name: 'standalone',
        labels: {},
      },
    ]);

    expect(result.map((group) => group.label)).toEqual(['alpha', 'beta', 'No Stack']);
    expect(result[0].options.map((option) => option.label)).toEqual(['api']);
    expect(result[1].options.map((option) => option.label)).toEqual(['worker']);
    expect(result[2].options.map((option) => option.label)).toEqual(['standalone']);
  });

  it('infers stack names from compose/swarm metadata when project labels are missing', () => {
    const result = buildStackGroupedContainerOptions([
      {
        id: '1',
        name: 'payments-api-1',
        labels: { 'com.docker.compose.service': 'api' },
      },
      {
        id: '2',
        name: 'worker.1.abcd123',
        labels: { 'com.docker.swarm.service.name': 'observability_worker' },
      },
    ]);

    expect(result.map((group) => group.label)).toEqual(['observability', 'payments']);
    expect(result[0].options[0].label).toBe('worker.1.abcd123');
    expect(result[1].options[0].label).toBe('payments-api-1');
  });

  it('prefers known stack names when labels are unavailable', () => {
    const result = buildStackGroupedContainerOptions(
      [
        {
          id: '1',
          name: 'alpha-api-1',
          labels: {},
        },
        {
          id: '2',
          name: 'beta_worker.1.abc123',
          labels: {},
        },
      ],
      ['alpha', 'beta'],
    );

    expect(result.map((group) => group.label)).toEqual(['alpha', 'beta']);
    expect(result[0].options[0].label).toBe('alpha-api-1');
    expect(result[1].options[0].label).toBe('beta_worker.1.abc123');
  });

  it('infers compose stack from container name even without labels', () => {
    const result = buildStackGroupedContainerOptions([
      { id: '1', name: 'ai-portainer-dashboard-frontend-1', labels: {} },
      { id: '2', name: 'ai-portainer-dashboard-backend-1', labels: {} },
      { id: '3', name: 'net-client', labels: {} },
    ]);

    expect(result.map((group) => group.label)).toEqual(['ai-portainer-dashboard', 'No Stack']);
    expect(result[0].options.map((option) => option.label)).toEqual([
      'ai-portainer-dashboard-backend-1',
      'ai-portainer-dashboard-frontend-1',
    ]);
    expect(result[1].options.map((option) => option.label)).toEqual(['net-client']);
  });
});
