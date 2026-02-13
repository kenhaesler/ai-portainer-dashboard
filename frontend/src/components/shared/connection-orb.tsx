import { useState, useEffect, useCallback } from 'react';
import { useSockets } from '@/providers/socket-provider';
import { cn } from '@/lib/utils';
import { useUiStore } from '@/stores/ui-store';

type ConnectionState = 'connected' | 'reconnecting' | 'disconnected';

export function ConnectionOrb() {
  const { connected, monitoringSocket } = useSockets();
  const potatoMode = useUiStore((s) => s.potatoMode);
  const [state, setState] = useState<ConnectionState>('disconnected');
  const [lastUpdate, setLastUpdate] = useState<number | null>(null);
  const [tooltipVisible, setTooltipVisible] = useState(false);

  useEffect(() => {
    if (!monitoringSocket) {
      setState('disconnected');
      return;
    }

    const onConnect = () => {
      setState('connected');
      setLastUpdate(Date.now());
    };
    const onDisconnect = () => setState('disconnected');
    const onReconnectAttempt = () => setState('reconnecting');
    const onData = () => setLastUpdate(Date.now());

    monitoringSocket.on('connect', onConnect);
    monitoringSocket.on('disconnect', onDisconnect);
    monitoringSocket.on('reconnect_attempt', onReconnectAttempt);
    monitoringSocket.on('insights:new', onData);

    // Set initial state
    if (monitoringSocket.connected) {
      setState('connected');
      setLastUpdate(Date.now());
    }

    return () => {
      monitoringSocket.off('connect', onConnect);
      monitoringSocket.off('disconnect', onDisconnect);
      monitoringSocket.off('reconnect_attempt', onReconnectAttempt);
      monitoringSocket.off('insights:new', onData);
    };
  }, [monitoringSocket]);

  // Update connected state from provider
  useEffect(() => {
    if (connected && state === 'disconnected') {
      setState('connected');
      setLastUpdate(Date.now());
    } else if (!connected && state === 'connected') {
      setState('disconnected');
    }
  }, [connected, state]);

  const getRelativeTime = useCallback(() => {
    if (!lastUpdate) return 'No data';
    const seconds = Math.floor((Date.now() - lastUpdate) / 1000);
    if (seconds < 5) return 'Just now';
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    return `${minutes}m ago`;
  }, [lastUpdate]);

  // Tick relative time every second
  const [, setTick] = useState(0);
  useEffect(() => {
    const interval = window.setInterval(() => setTick((t) => t + 1), potatoMode ? 5000 : 1000);
    return () => clearInterval(interval);
  }, [potatoMode]);

  const stateConfig = {
    connected: {
      color: 'bg-emerald-500',
      ring: 'ring-emerald-500/30',
      label: 'Connected',
      pulse: !potatoMode,
    },
    reconnecting: {
      color: 'bg-amber-500',
      ring: 'ring-amber-500/30',
      label: 'Reconnecting',
      pulse: !potatoMode,
    },
    disconnected: {
      color: 'bg-red-500',
      ring: 'ring-red-500/30',
      label: 'Disconnected',
      pulse: false,
    },
  };

  const config = stateConfig[state];

  return (
    <div
      className="relative"
      onMouseEnter={() => setTooltipVisible(true)}
      onMouseLeave={() => setTooltipVisible(false)}
    >
      <div
        className={cn(
          'h-2.5 w-2.5 rounded-full transition-colors duration-300',
          config.color,
          config.pulse && 'ring-2 animate-pulse',
          config.pulse && config.ring,
        )}
        role="status"
        aria-label={`WebSocket ${config.label}`}
      />

      {/* Tooltip */}
      {tooltipVisible && (
        <div className="absolute right-0 top-full z-50 mt-2 whitespace-nowrap rounded-md border bg-popover px-3 py-1.5 text-xs shadow-md">
          <p className="font-medium">{config.label}</p>
          <p className="text-muted-foreground">Last update: {getRelativeTime()}</p>
        </div>
      )}
    </div>
  );
}
