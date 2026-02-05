import { describe, it, expect, beforeEach } from 'vitest';
import { useSearchStore } from './search-store';

describe('useSearchStore', () => {
  beforeEach(() => {
    useSearchStore.setState({ recent: [] });
  });

  describe('initial state', () => {
    it('should have empty recent list', () => {
      const state = useSearchStore.getState();
      expect(state.recent).toEqual([]);
    });
  });

  describe('addRecent', () => {
    it('should add a search term to history', () => {
      const { addRecent } = useSearchStore.getState();
      addRecent('postgres');

      const { recent } = useSearchStore.getState();
      expect(recent).toHaveLength(1);
      expect(recent[0].term).toBe('postgres');
      expect(recent[0].lastUsed).toBeGreaterThan(0);
    });

    it('should deduplicate existing terms case-insensitively', () => {
      const { addRecent } = useSearchStore.getState();
      addRecent('postgres');
      addRecent('POSTGRES');

      const { recent } = useSearchStore.getState();
      expect(recent).toHaveLength(1);
      expect(recent[0].term).toBe('POSTGRES');
    });

    it('should move existing terms to the front', () => {
      const { addRecent } = useSearchStore.getState();
      addRecent('redis');
      addRecent('postgres');
      addRecent('redis');

      const { recent } = useSearchStore.getState();
      expect(recent).toHaveLength(2);
      expect(recent[0].term).toBe('redis');
      expect(recent[1].term).toBe('postgres');
    });

    it('should enforce MAX_RECENT limit of 6', () => {
      const { addRecent } = useSearchStore.getState();
      for (let i = 0; i < 8; i++) {
        addRecent(`term-${i}`);
      }

      const { recent } = useSearchStore.getState();
      expect(recent).toHaveLength(6);
      expect(recent[0].term).toBe('term-7');
    });

    it('should ignore empty or whitespace-only terms', () => {
      const { addRecent } = useSearchStore.getState();
      addRecent('');
      addRecent('   ');

      const { recent } = useSearchStore.getState();
      expect(recent).toHaveLength(0);
    });

    it('should trim whitespace from terms', () => {
      const { addRecent } = useSearchStore.getState();
      addRecent('  postgres  ');

      const { recent } = useSearchStore.getState();
      expect(recent[0].term).toBe('postgres');
    });
  });

  describe('clearRecent', () => {
    it('should remove all history', () => {
      const { addRecent } = useSearchStore.getState();
      addRecent('redis');
      addRecent('postgres');

      const { clearRecent } = useSearchStore.getState();
      clearRecent();

      const { recent } = useSearchStore.getState();
      expect(recent).toHaveLength(0);
    });
  });
});
