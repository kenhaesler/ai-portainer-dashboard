import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ViewMode = 'grid' | 'table';

interface UiState {
  sidebarCollapsed: boolean;
  commandPaletteOpen: boolean;
  potatoMode: boolean;
  collapsedGroups: Record<string, boolean>;
  pageViewModes: Record<string, ViewMode>;
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setCommandPaletteOpen: (open: boolean) => void;
  setPotatoMode: (enabled: boolean) => void;
  togglePotatoMode: () => void;
  toggleGroup: (groupTitle: string) => void;
  setPageViewMode: (page: string, mode: ViewMode) => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      commandPaletteOpen: false,
      potatoMode: false,
      collapsedGroups: {},
      pageViewModes: {},
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
      setPageViewMode: (page, mode) =>
        set((s) => ({
          pageViewModes: { ...s.pageViewModes, [page]: mode },
        })),
    }),
    {
      name: 'ui-storage',
      partialize: (state) => ({
        sidebarCollapsed: state.sidebarCollapsed,
        potatoMode: state.potatoMode,
        collapsedGroups: state.collapsedGroups,
        pageViewModes: state.pageViewModes,
      }),
    }
  )
);
