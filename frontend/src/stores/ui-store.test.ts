import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act } from '@testing-library/react';
import { useUiStore } from './ui-store';

const STORAGE_KEY = 'ui-storage';

describe('useUiStore', () => {
  beforeEach(() => {
    // Reset to initial state without touching persistence
    useUiStore.setState({
      sidebarCollapsed: false,
      commandPaletteOpen: false,
      potatoMode: false,
      collapsedGroups: {},
      pageViewModes: {},
    });
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  describe('initial state', () => {
    it('exposes the documented defaults', () => {
      const state = useUiStore.getState();
      expect(state.sidebarCollapsed).toBe(false);
      expect(state.commandPaletteOpen).toBe(false);
      expect(state.potatoMode).toBe(false);
      expect(state.collapsedGroups).toEqual({});
      expect(state.pageViewModes).toEqual({});
    });
  });

  describe('toggleSidebar', () => {
    it('flips sidebarCollapsed from false to true', () => {
      act(() => {
        useUiStore.getState().toggleSidebar();
      });
      expect(useUiStore.getState().sidebarCollapsed).toBe(true);
    });

    it('flips back to false on a second call', () => {
      act(() => {
        useUiStore.getState().toggleSidebar();
        useUiStore.getState().toggleSidebar();
      });
      expect(useUiStore.getState().sidebarCollapsed).toBe(false);
    });

    it('does not mutate other state slices', () => {
      act(() => {
        useUiStore.getState().toggleSidebar();
      });
      const state = useUiStore.getState();
      expect(state.potatoMode).toBe(false);
      expect(state.commandPaletteOpen).toBe(false);
      expect(state.pageViewModes).toEqual({});
    });
  });

  describe('togglePotatoMode', () => {
    it('flips potatoMode from false to true', () => {
      act(() => {
        useUiStore.getState().togglePotatoMode();
      });
      expect(useUiStore.getState().potatoMode).toBe(true);
    });

    it('flips back to false on a second call', () => {
      act(() => {
        useUiStore.getState().togglePotatoMode();
        useUiStore.getState().togglePotatoMode();
      });
      expect(useUiStore.getState().potatoMode).toBe(false);
    });

    it('respects setPotatoMode for explicit values', () => {
      act(() => {
        useUiStore.getState().setPotatoMode(true);
      });
      expect(useUiStore.getState().potatoMode).toBe(true);

      act(() => {
        useUiStore.getState().setPotatoMode(false);
      });
      expect(useUiStore.getState().potatoMode).toBe(false);
    });
  });

  describe('setPageViewMode', () => {
    it('records a per-page view mode', () => {
      act(() => {
        useUiStore.getState().setPageViewMode('fleet', 'table');
      });
      expect(useUiStore.getState().pageViewModes).toEqual({ fleet: 'table' });
    });

    it('overwrites existing mode for the same page', () => {
      act(() => {
        useUiStore.getState().setPageViewMode('fleet', 'table');
        useUiStore.getState().setPageViewMode('fleet', 'grid');
      });
      expect(useUiStore.getState().pageViewModes).toEqual({ fleet: 'grid' });
    });

    it('keeps modes for other pages independent', () => {
      act(() => {
        useUiStore.getState().setPageViewMode('fleet', 'table');
        useUiStore.getState().setPageViewMode('stacks', 'grid');
      });
      expect(useUiStore.getState().pageViewModes).toEqual({
        fleet: 'table',
        stacks: 'grid',
      });
    });
  });

  describe('persistence (zustand persist middleware)', () => {
    it('writes persisted slices to localStorage under "ui-storage"', () => {
      act(() => {
        useUiStore.getState().toggleSidebar();
        useUiStore.getState().togglePotatoMode();
        useUiStore.getState().setPageViewMode('fleet', 'table');
        useUiStore.getState().toggleGroup('Operations');
      });

      const raw = window.localStorage.getItem(STORAGE_KEY);
      expect(raw).not.toBeNull();
      const parsed = JSON.parse(raw as string);
      // zustand persist wraps state under .state
      expect(parsed.state.sidebarCollapsed).toBe(true);
      expect(parsed.state.potatoMode).toBe(true);
      expect(parsed.state.pageViewModes).toEqual({ fleet: 'table' });
      expect(parsed.state.collapsedGroups).toEqual({ Operations: true });
    });

    it('does not persist commandPaletteOpen (excluded by partialize)', () => {
      act(() => {
        useUiStore.getState().setCommandPaletteOpen(true);
      });

      const raw = window.localStorage.getItem(STORAGE_KEY);
      expect(raw).not.toBeNull();
      const parsed = JSON.parse(raw as string);
      expect(parsed.state.commandPaletteOpen).toBeUndefined();
    });

    it('rehydrates persisted values when persist.rehydrate() is called', async () => {
      // NOTE: setState() on the store triggers persist to write to localStorage,
      // which would clobber a seed written before setState. Ordering matters:
      // (1) reset in-memory state, (2) seed localStorage, (3) rehydrate.
      useUiStore.setState({
        sidebarCollapsed: false,
        potatoMode: false,
        collapsedGroups: {},
        pageViewModes: {},
      });

      const seeded = {
        state: {
          sidebarCollapsed: true,
          potatoMode: true,
          collapsedGroups: { Inventory: true },
          pageViewModes: { workloads: 'grid' },
        },
        version: 0,
      };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded));

      // Trigger rehydration from the persist API
      await useUiStore.persist.rehydrate();

      const state = useUiStore.getState();
      expect(state.sidebarCollapsed).toBe(true);
      expect(state.potatoMode).toBe(true);
      expect(state.collapsedGroups).toEqual({ Inventory: true });
      expect(state.pageViewModes).toEqual({ workloads: 'grid' });
    });
  });
});
