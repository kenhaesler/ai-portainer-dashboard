import { describe, it, expect, beforeEach } from 'vitest';
import { useFavoritesStore } from './favorites-store';

describe('useFavoritesStore', () => {
  beforeEach(() => {
    useFavoritesStore.setState({ favoriteIds: [] });
  });

  describe('initial state', () => {
    it('should have empty favoriteIds by default', () => {
      const state = useFavoritesStore.getState();
      expect(state.favoriteIds).toEqual([]);
    });
  });

  describe('toggleFavorite', () => {
    it('should add a favorite when not present', () => {
      const { toggleFavorite } = useFavoritesStore.getState();

      toggleFavorite(1, 'abc123');

      expect(useFavoritesStore.getState().favoriteIds).toEqual(['1:abc123']);
    });

    it('should remove a favorite when already present', () => {
      const { toggleFavorite } = useFavoritesStore.getState();

      toggleFavorite(1, 'abc123');
      toggleFavorite(1, 'abc123');

      expect(useFavoritesStore.getState().favoriteIds).toEqual([]);
    });

    it('should handle multiple favorites', () => {
      const { toggleFavorite } = useFavoritesStore.getState();

      toggleFavorite(1, 'abc');
      toggleFavorite(2, 'def');
      toggleFavorite(1, 'ghi');

      expect(useFavoritesStore.getState().favoriteIds).toEqual([
        '1:abc',
        '2:def',
        '1:ghi',
      ]);
    });

    it('should only remove the toggled favorite', () => {
      const { toggleFavorite } = useFavoritesStore.getState();

      toggleFavorite(1, 'abc');
      toggleFavorite(2, 'def');
      toggleFavorite(1, 'abc');

      expect(useFavoritesStore.getState().favoriteIds).toEqual(['2:def']);
    });
  });

  describe('isFavorite', () => {
    it('should return false when not favorited', () => {
      const { isFavorite } = useFavoritesStore.getState();
      expect(isFavorite(1, 'abc')).toBe(false);
    });

    it('should return true when favorited', () => {
      const { toggleFavorite } = useFavoritesStore.getState();
      toggleFavorite(1, 'abc');

      const { isFavorite } = useFavoritesStore.getState();
      expect(isFavorite(1, 'abc')).toBe(true);
    });

    it('should return false after un-favoriting', () => {
      const { toggleFavorite } = useFavoritesStore.getState();
      toggleFavorite(1, 'abc');
      toggleFavorite(1, 'abc');

      const { isFavorite } = useFavoritesStore.getState();
      expect(isFavorite(1, 'abc')).toBe(false);
    });
  });

  describe('removeFavorite', () => {
    it('should remove a specific favorite', () => {
      const { toggleFavorite } = useFavoritesStore.getState();
      toggleFavorite(1, 'abc');
      toggleFavorite(2, 'def');

      const { removeFavorite } = useFavoritesStore.getState();
      removeFavorite(1, 'abc');

      expect(useFavoritesStore.getState().favoriteIds).toEqual(['2:def']);
    });

    it('should be a no-op when favorite does not exist', () => {
      const { toggleFavorite } = useFavoritesStore.getState();
      toggleFavorite(1, 'abc');

      const { removeFavorite } = useFavoritesStore.getState();
      removeFavorite(99, 'nonexistent');

      expect(useFavoritesStore.getState().favoriteIds).toEqual(['1:abc']);
    });
  });

  describe('clearAll', () => {
    it('should remove all favorites', () => {
      const { toggleFavorite } = useFavoritesStore.getState();
      toggleFavorite(1, 'a');
      toggleFavorite(2, 'b');
      toggleFavorite(3, 'c');

      const { clearAll } = useFavoritesStore.getState();
      clearAll();

      expect(useFavoritesStore.getState().favoriteIds).toEqual([]);
    });

    it('should work when already empty', () => {
      const { clearAll } = useFavoritesStore.getState();
      clearAll();

      expect(useFavoritesStore.getState().favoriteIds).toEqual([]);
    });

    it('should allow adding favorites again after clearing', () => {
      const { toggleFavorite, clearAll } = useFavoritesStore.getState();

      toggleFavorite(1, 'abc');
      clearAll();
      toggleFavorite(2, 'def');

      expect(useFavoritesStore.getState().favoriteIds).toEqual(['2:def']);
    });
  });
});
