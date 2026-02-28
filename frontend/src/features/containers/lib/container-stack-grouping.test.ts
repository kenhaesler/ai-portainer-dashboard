import { describe, it, expect } from 'vitest';
import { buildStackGroupedContainerOptions, resolveContainerStackName } from './container-stack-grouping';

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

describe('resolveContainerStackName — ReDoS-safe service name handling', () => {
  it('infers stack from compose service with dot in name', () => {
    const result = resolveContainerStackName(
      { name: 'myapp-api.v2-1', labels: { 'com.docker.compose.service': 'api.v2' } },
    );
    expect(result).toBe('myapp');
  });

  it('infers stack from compose service with plus signs', () => {
    const result = resolveContainerStackName(
      { name: 'myapp-c++-1', labels: { 'com.docker.compose.service': 'c++' } },
    );
    expect(result).toBe('myapp');
  });

  it('infers stack from compose service with brackets', () => {
    const result = resolveContainerStackName(
      { name: 'myapp-svc[0]-1', labels: { 'com.docker.compose.service': 'svc[0]' } },
    );
    expect(result).toBe('myapp');
  });

  it('infers stack from compose service with parentheses', () => {
    const result = resolveContainerStackName(
      { name: 'myapp-svc(test)-1', labels: { 'com.docker.compose.service': 'svc(test)' } },
    );
    expect(result).toBe('myapp');
  });

  it('infers stack from swarm service with special chars', () => {
    const result = resolveContainerStackName(
      { name: 'mystack_api.v2.1.abc123', labels: { 'com.docker.compose.service': 'api.v2' } },
    );
    expect(result).toBe('mystack');
  });

  it('does not hang on ReDoS-pattern service names', () => {
    const evilService = '(a+)+b';
    const container = { name: `stack-${evilService}-1`, labels: { 'com.docker.compose.service': evilService } };
    const start = performance.now();
    resolveContainerStackName(container);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(100);
  });

  it('still resolves standard compose service names correctly', () => {
    const result = resolveContainerStackName(
      { name: 'payments-api-1', labels: { 'com.docker.compose.service': 'api' } },
    );
    expect(result).toBe('payments');
  });
});
