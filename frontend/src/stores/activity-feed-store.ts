import { create } from 'zustand';

export interface ActivityEvent {
  id: string;
  type: 'container' | 'anomaly' | 'insight' | 'connection' | 'incident';
  severity: 'success' | 'warning' | 'error' | 'info';
  message: string;
  timestamp: number;
  /** Optional navigation target path */
  link?: string;
}

const MAX_EVENTS = 50;

interface ActivityFeedState {
  events: ActivityEvent[];
  collapsed: boolean;
  unreadCount: number;
  addEvent: (event: Omit<ActivityEvent, 'id' | 'timestamp'>) => void;
  markAllRead: () => void;
  toggleCollapsed: () => void;
  setCollapsed: (collapsed: boolean) => void;
  clearAll: () => void;
}

export const useActivityFeedStore = create<ActivityFeedState>((set) => ({
  events: [],
  collapsed: true,
  unreadCount: 0,
  addEvent: (event) =>
    set((state) => {
      const newEvent: ActivityEvent = {
        ...event,
        id: crypto.randomUUID(),
        timestamp: Date.now(),
      };
      const events = [newEvent, ...state.events].slice(0, MAX_EVENTS);
      return {
        events,
        unreadCount: state.collapsed ? state.unreadCount + 1 : 0,
      };
    }),
  markAllRead: () => set({ unreadCount: 0 }),
  toggleCollapsed: () =>
    set((state) => ({
      collapsed: !state.collapsed,
      unreadCount: state.collapsed ? 0 : state.unreadCount,
    })),
  setCollapsed: (collapsed) =>
    set({ collapsed, unreadCount: collapsed ? 0 : 0 }),
  clearAll: () => set({ events: [], unreadCount: 0 }),
}));
