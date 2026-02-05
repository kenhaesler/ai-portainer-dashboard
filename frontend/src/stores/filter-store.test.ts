import { describe, it, expect, beforeEach } from 'vitest';
import { useFilterStore } from './filter-store';

describe('useFilterStore', () => {
  beforeEach(() => {
    // Reset store state before each test
    useFilterStore.setState({
      selectedEndpointId: null,
      selectedEnvironment: null,
    });
  });

  describe('initial state', () => {
    it('should have null selectedEndpointId by default', () => {
      const state = useFilterStore.getState();
      expect(state.selectedEndpointId).toBeNull();
    });

    it('should have null selectedEnvironment by default', () => {
      const state = useFilterStore.getState();
      expect(state.selectedEnvironment).toBeNull();
    });
  });

  describe('setEndpoint', () => {
    it('should set endpoint id', () => {
      const { setEndpoint } = useFilterStore.getState();

      setEndpoint(1);

      expect(useFilterStore.getState().selectedEndpointId).toBe(1);
    });

    it('should update endpoint id when called multiple times', () => {
      const { setEndpoint } = useFilterStore.getState();

      setEndpoint(1);
      setEndpoint(2);
      setEndpoint(3);

      expect(useFilterStore.getState().selectedEndpointId).toBe(3);
    });

    it('should set endpoint id to null', () => {
      const { setEndpoint } = useFilterStore.getState();

      setEndpoint(1);
      setEndpoint(null);

      expect(useFilterStore.getState().selectedEndpointId).toBeNull();
    });

    it('should not affect other state properties', () => {
      const { setEndpoint, setEnvironment } = useFilterStore.getState();

      setEnvironment('production');
      setEndpoint(5);

      expect(useFilterStore.getState().selectedEnvironment).toBe('production');
      expect(useFilterStore.getState().selectedEndpointId).toBe(5);
    });
  });

  describe('setEnvironment', () => {
    it('should set environment', () => {
      const { setEnvironment } = useFilterStore.getState();

      setEnvironment('production');

      expect(useFilterStore.getState().selectedEnvironment).toBe('production');
    });

    it('should update environment when called multiple times', () => {
      const { setEnvironment } = useFilterStore.getState();

      setEnvironment('development');
      setEnvironment('staging');
      setEnvironment('production');

      expect(useFilterStore.getState().selectedEnvironment).toBe('production');
    });

    it('should set environment to null', () => {
      const { setEnvironment } = useFilterStore.getState();

      setEnvironment('production');
      setEnvironment(null);

      expect(useFilterStore.getState().selectedEnvironment).toBeNull();
    });

    it('should not affect other state properties', () => {
      const { setEndpoint, setEnvironment } = useFilterStore.getState();

      setEndpoint(10);
      setEnvironment('staging');

      expect(useFilterStore.getState().selectedEndpointId).toBe(10);
      expect(useFilterStore.getState().selectedEnvironment).toBe('staging');
    });
  });

  describe('reset', () => {
    it('should reset all filters to null', () => {
      const { setEndpoint, setEnvironment, reset } = useFilterStore.getState();

      setEndpoint(5);
      setEnvironment('production');
      reset();

      expect(useFilterStore.getState().selectedEndpointId).toBeNull();
      expect(useFilterStore.getState().selectedEnvironment).toBeNull();
    });

    it('should work when already in default state', () => {
      const { reset } = useFilterStore.getState();

      reset();

      expect(useFilterStore.getState().selectedEndpointId).toBeNull();
      expect(useFilterStore.getState().selectedEnvironment).toBeNull();
    });

    it('should allow setting values again after reset', () => {
      const { setEndpoint, setEnvironment, reset } = useFilterStore.getState();

      setEndpoint(1);
      setEnvironment('dev');
      reset();
      setEndpoint(2);
      setEnvironment('prod');

      expect(useFilterStore.getState().selectedEndpointId).toBe(2);
      expect(useFilterStore.getState().selectedEnvironment).toBe('prod');
    });
  });

  describe('combined operations', () => {
    it('should handle rapid state changes', () => {
      const { setEndpoint, setEnvironment, reset } = useFilterStore.getState();

      for (let i = 0; i < 100; i++) {
        setEndpoint(i);
        setEnvironment(`env-${i}`);
      }
      reset();
      setEndpoint(999);

      expect(useFilterStore.getState().selectedEndpointId).toBe(999);
      expect(useFilterStore.getState().selectedEnvironment).toBeNull();
    });
  });
});
