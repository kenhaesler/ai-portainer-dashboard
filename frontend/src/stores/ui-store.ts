import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface UiState {
  sidebarCollapsed: boolean;
  commandPaletteOpen: boolean;
  potatoMode: boolean;
  collapsedGroups: Record<string, boolean>;
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setCommandPaletteOpen: (open: boolean) => void;
  setPotatoMode: (enabled: boolean) => void;
  togglePotatoMode: () => void;
  toggleGroup: (groupTitle: string) => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      commandPaletteOpen: false,
      potatoMode: false,
      collapsedGroups: {},
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
      setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
      setPotatoMode: (enabled) => set({ potatoMode: enabled }),
      togglePotatoMode: () => set((s) => ({ potatoMode: !s.potatoMode })),
      toggleGroup: (groupTitle) =>
        set((s) => ({
          collapsedGroups: {
            ...s.collapsedGroups,
            [groupTitle]: !s.collapsedGroups[groupTitle],
          },
        })),
    }),
    {
      name: 'ui-storage',
      partialize: (state) => ({
        sidebarCollapsed: state.sidebarCollapsed,
        potatoMode: state.potatoMode,
        collapsedGroups: state.collapsedGroups,
      }),
    }
  )
);
