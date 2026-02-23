import { createContext, useContext, useEffect, useState } from 'react';
import { Socket } from 'socket.io-client';
import { getNamespaceSocket, disconnectAll } from '@/lib/socket';
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
