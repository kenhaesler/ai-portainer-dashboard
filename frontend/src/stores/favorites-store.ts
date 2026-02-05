import { create } from 'zustand';
import { persist } from 'zustand/middleware';

function toKey(endpointId: number, containerId: string): string {
  return `${endpointId}:${containerId}`;
}

interface FavoritesState {
  favoriteIds: string[];
  toggleFavorite: (endpointId: number, containerId: string) => void;
  removeFavorite: (endpointId: number, containerId: string) => void;
  isFavorite: (endpointId: number, containerId: string) => boolean;
  clearAll: () => void;
}

export const useFavoritesStore = create<FavoritesState>()(
  persist(
    (set, get) => ({
      favoriteIds: [],
      toggleFavorite: (endpointId, containerId) =>
        set((state) => {
          const key = toKey(endpointId, containerId);
          const exists = state.favoriteIds.includes(key);
          return {
            favoriteIds: exists
              ? state.favoriteIds.filter((id) => id !== key)
              : [...state.favoriteIds, key],
          };
        }),
      removeFavorite: (endpointId, containerId) =>
        set((state) => {
          const key = toKey(endpointId, containerId);
          return { favoriteIds: state.favoriteIds.filter((id) => id !== key) };
        }),
      isFavorite: (endpointId, containerId) => {
        const key = toKey(endpointId, containerId);
        return get().favoriteIds.includes(key);
      },
      clearAll: () => set({ favoriteIds: [] }),
    }),
    {
      name: 'container-favorites',
      partialize: (state) => ({ favoriteIds: state.favoriteIds }),
    },
  ),
);
