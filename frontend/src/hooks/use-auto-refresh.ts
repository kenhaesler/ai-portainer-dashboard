import { useState, useCallback, useEffect } from 'react';

const STORAGE_KEY = 'ai-portainer-auto-refresh';
const VALID_INTERVALS = [0, 15, 30, 60, 120, 300] as const;

type RefreshInterval = (typeof VALID_INTERVALS)[number];

interface AutoRefreshState {
  interval: RefreshInterval;
  enabled: boolean;
}

function loadState(defaultInterval: RefreshInterval): AutoRefreshState {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as AutoRefreshState;
      if (VALID_INTERVALS.includes(parsed.interval as RefreshInterval)) {
        return parsed;
      }
    }
  } catch {
    // Ignore parse errors
  }
  return {
    interval: defaultInterval,
    enabled: defaultInterval > 0,
  };
}

function saveState(state: AutoRefreshState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage errors
  }
}

export function useAutoRefresh(defaultInterval: RefreshInterval = 30) {
  const [state, setState] = useState<AutoRefreshState>(() =>
    loadState(defaultInterval)
  );

  useEffect(() => {
    saveState(state);
  }, [state]);

  const setInterval = useCallback((interval: RefreshInterval) => {
    setState({
      interval,
      enabled: interval > 0,
    });
  }, []);

  const toggle = useCallback(() => {
    setState((prev) => ({
      ...prev,
      enabled: prev.interval > 0 ? !prev.enabled : false,
    }));
  }, []);

  return {
    interval: state.interval,
    setInterval,
    enabled: state.enabled,
    toggle,
    options: VALID_INTERVALS,
  };
}
