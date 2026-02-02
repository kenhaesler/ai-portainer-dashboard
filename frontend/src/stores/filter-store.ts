import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface FilterState {
  selectedEndpointId: number | null;
  selectedEnvironment: string | null;
  setEndpoint: (id: number | null) => void;
  setEnvironment: (env: string | null) => void;
  reset: () => void;
}

export const useFilterStore = create<FilterState>()(
  persist(
    (set) => ({
      selectedEndpointId: null,
      selectedEnvironment: null,
      setEndpoint: (id) => set({ selectedEndpointId: id }),
      setEnvironment: (env) => set({ selectedEnvironment: env }),
      reset: () => set({ selectedEndpointId: null, selectedEnvironment: null }),
    }),
    { name: 'dashboard-filters' }
  )
);
