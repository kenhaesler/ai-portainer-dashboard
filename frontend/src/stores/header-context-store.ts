import { create } from 'zustand';

/**
 * Ephemeral, per-session header context. The Metrics page sets the selected
 * container name here so the shared <Header> can show it in the breadcrumb,
 * and clears it on unmount. Not persisted — it is page state, not a preference.
 */
interface HeaderContextState {
  metricsContainerName: string | null;
  setMetricsContainerName: (name: string | null) => void;
  clearMetricsContainerName: () => void;
}

export const useHeaderContextStore = create<HeaderContextState>((set) => ({
  metricsContainerName: null,
  setMetricsContainerName: (name) => set({ metricsContainerName: name }),
  clearMetricsContainerName: () => set({ metricsContainerName: null }),
}));
