import { createContext, useContext, useEffect, useState } from 'react';
import { Socket } from 'socket.io-client';
import { getNamespaceSocket, disconnectAll } from '@/shared/lib/socket';
import { useAuth } from './auth-provider';
import { useUiStore } from '@/stores/ui-store';

interface SocketContextType {
  llmSocket: Socket | null;
  monitoringSocket: Socket | null;
  remediationSocket: Socket | null;
  connected: boolean;
}

const SocketContext = createContext<SocketContextType>({
  llmSocket: null,
  monitoringSocket: null,
  remediationSocket: null,
  connected: false,
});

export function SocketProvider({ children }: { children: React.ReactNode }) {
  const { token, isAuthenticated } = useAuth();
  const potatoMode = useUiStore((state) => state.potatoMode);
  const [sockets, setSockets] = useState<Omit<SocketContextType, 'connected'>>({
    llmSocket: null,
    monitoringSocket: null,
    remediationSocket: null,
  });
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!isAuthenticated || !token) {
      disconnectAll();
      setSockets({ llmSocket: null, monitoringSocket: null, remediationSocket: null });
      setConnected(false);
      return;
    }

    // getNamespaceSocket is idempotent: returns the cached socket if it already
    // exists for this namespace+token, so calling this on every effect run is safe.
    const monitoring = getNamespaceSocket('monitoring', token);
    const llm = potatoMode ? null : getNamespaceSocket('llm', token);
    const remediation = potatoMode ? null : getNamespaceSocket('remediation', token);
    const activeSockets = [llm, monitoring, remediation].filter((s): s is Socket => s !== null);

    setSockets({ llmSocket: llm, monitoringSocket: monitoring, remediationSocket: remediation });

    const updateConnected = () => {
      setConnected(activeSockets.some((s) => s.connected));
    };

    for (const s of activeSockets) {
      s.on('connect', updateConnected);
      s.on('disconnect', updateConnected);
    }

    // Set initial connected state
    updateConnected();

    // Clean up ONLY the event listeners — do NOT disconnect the sockets.
    // Disconnecting on every effect cleanup causes thrashing: each re-run due to
    // potatoMode or token changes would tear down all connections and immediately
    // recreate them, racing with socket.io's own reconnection timers.
    return () => {
      for (const s of activeSockets) {
        s.off('connect', updateConnected);
        s.off('disconnect', updateConnected);
      }
    };
  }, [isAuthenticated, token, potatoMode]);

  return (
    <SocketContext.Provider value={{ ...sockets, connected }}>
      {children}
    </SocketContext.Provider>
  );
}

export function useSockets() {
  return useContext(SocketContext);
}

/**
 * Tracks the live connection state of a specific socket.
 *
 * Reading `socket.connected` directly during render is stale: socket.io
 * mutates that flag asynchronously and React has no way to know. The
 * SocketProvider's aggregated `connected` field only re-renders consumers
 * when the OR-of-all-sockets actually flips, so a single namespace coming
 * up after another is already connected produces no re-render and the
 * stale `false` from the first paint persists.
 */
export function useSocketConnected(socket: Socket | null): boolean {
  const [connected, setConnected] = useState(socket?.connected ?? false);

  useEffect(() => {
    if (!socket) {
      setConnected(false);
      return;
    }

    setConnected(socket.connected);

    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
    };
  }, [socket]);

  return connected;
}
