import { describe, it, expect, beforeEach } from 'vitest';
import { useHeaderContextStore } from './header-context-store';

describe('useHeaderContextStore', () => {
  beforeEach(() => {
    useHeaderContextStore.setState({ metricsContainerName: null });
  });

  it('defaults to no container name', () => {
    expect(useHeaderContextStore.getState().metricsContainerName).toBeNull();
  });

  it('sets the container name', () => {
    useHeaderContextStore.getState().setMetricsContainerName('nginx-proxy');
    expect(useHeaderContextStore.getState().metricsContainerName).toBe('nginx-proxy');
  });

  it('clears the container name', () => {
    useHeaderContextStore.getState().setMetricsContainerName('nginx-proxy');
    useHeaderContextStore.getState().clearMetricsContainerName();
    expect(useHeaderContextStore.getState().metricsContainerName).toBeNull();
  });
});
