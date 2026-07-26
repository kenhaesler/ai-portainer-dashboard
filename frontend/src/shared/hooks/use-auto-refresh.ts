import { useState, useCallback, useEffect, useRef } from 'react';

const STORAGE_KEY = 'ai-portainer-auto-refresh';
const VALID_INTERVALS = [0, 15, 30, 60, 120, 300] as const;

export type RefreshInterval = (typeof VALID_INTERVALS)[number];

interface AutoRefreshState {
  interval: RefreshInterval;
  enabled: boolean;
}

export interface AutoRefreshOptions {
  /**
   * Called every `interval` seconds while auto-refresh is enabled.
   *
   * The hook owns the timer. Before this existed the hook owned only state and
   * scheduled nothing, so every consumer had to remember to write its own
   * `window.setInterval` effect — one page did (with a comment naming the trap)
   * and two did not, leaving their refresh dropdowns purely decorative.
   */
  onTick?: () => void;
  /**
   * Suffix for the localStorage key, so a page can keep its own cadence.
   *
   * Omitted, every page shares one key — which is why a page asking for
   * `useAutoRefresh(0)` could open showing "Every 30s" because a different page
   * had stored 30. Pass a stable, page-specific string to opt out.
   */
  storageKey?: string;
}

function resolveStorageKey(storageKey?: string): string {
  return storageKey ? `${STORAGE_KEY}:${storageKey}` : STORAGE_KEY;
}

function loadState(defaultInterval: RefreshInterval, storageKey?: string): AutoRefreshState {
  try {
    const stored = localStorage.getItem(resolveStorageKey(storageKey));
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

function saveState(state: AutoRefreshState, storageKey?: string): void {
  try {
    localStorage.setItem(resolveStorageKey(storageKey), JSON.stringify(state));
  } catch {
    // Ignore storage errors
  }
}

export function useAutoRefresh(
  defaultInterval: RefreshInterval = 30,
  opts: AutoRefreshOptions = {}
) {
  const { onTick, storageKey } = opts;
  const [state, setState] = useState<AutoRefreshState>(() =>
    loadState(defaultInterval, storageKey)
  );

  // The state this hook mounted with, held by identity so the effect below can
  // tell "the default we started with" from "a value the user picked".
  const initialStateRef = useRef(state);
  useEffect(() => {
    // Do not persist on mount. Merely visiting a page must not record its
    // default as a choice, or "never touched the control" becomes
    // indistinguishable from "explicitly chose this cadence" — and on the
    // shared key it was worse than cosmetic: opening Image Footprint, which
    // asks for 60s, wrote 60 to the fleet-wide key and quietly slowed every
    // dashboard query on every other page.
    //
    // Compared by identity, not by value: `setRefreshInterval` and `toggle`
    // both build a fresh object, so re-selecting the value already shown still
    // persists. Identity also survives StrictMode's mount/cleanup/mount, which
    // a boolean first-run flag would not — the flag would be spent on the
    // first invocation and the second would write the default anyway.
    if (state === initialStateRef.current) return;
    saveState(state, storageKey);
  }, [state, storageKey]);

  const setRefreshInterval = useCallback((interval: RefreshInterval) => {
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

  // Held in a ref so a consumer passing an inline arrow (the normal case)
  // doesn't tear down and re-arm the timer on every render — only a change of
  // interval/enabled restarts it.
  const onTickRef = useRef(onTick);
  useEffect(() => {
    onTickRef.current = onTick;
  }, [onTick]);

  const hasOnTick = !!onTick;
  useEffect(() => {
    if (!hasOnTick || !state.enabled || state.interval <= 0) return;
    // `window.setInterval`, not the bare global: this module and most call
    // sites bind a local named `setInterval` (the deprecated alias returned
    // below), which shadows the global and is exactly why wiring the timer by
    // hand at each call site was error-prone.
    const id = window.setInterval(() => {
      onTickRef.current?.();
    }, state.interval * 1000);
    return () => window.clearInterval(id);
  }, [hasOnTick, state.enabled, state.interval]);

  return {
    interval: state.interval,
    setRefreshInterval,
    /**
     * @deprecated Use `setRefreshInterval`. Destructuring this shadows
     * `window.setInterval` in the consuming module. Kept so existing call sites
     * keep compiling.
     */
    setInterval: setRefreshInterval,
    enabled: state.enabled,
    toggle,
    options: VALID_INTERVALS,
  };
}
