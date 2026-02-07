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
});
