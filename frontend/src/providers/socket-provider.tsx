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
  const [sockets, setSockets] = useState<SocketContextType>({
    llmSocket: null,
    monitoringSocket: null,
    remediationSocket: null,
    connected: false,
  });

  useEffect(() => {
    if (!isAuthenticated || !token) {
      disconnectAll();
      setSockets({
        llmSocket: null,
        monitoringSocket: null,
        remediationSocket: null,
        connected: false,
      });
      return;
    }

    const monitoring = getNamespaceSocket('monitoring', token);
    const llm = potatoMode ? null : getNamespaceSocket('llm', token);
    const remediation = potatoMode ? null : getNamespaceSocket('remediation', token);
    const activeSockets = [llm, monitoring, remediation].filter((s): s is Socket => s !== null);

    const updateConnected = () => {
      setSockets((prev) => ({
        ...prev,
        connected: activeSockets.some((socket) => socket.connected),
      }));
    };

    for (const s of activeSockets) {
      s.on('connect', updateConnected);
      s.on('disconnect', updateConnected);
    }

    setSockets({
      llmSocket: llm,
      monitoringSocket: monitoring,
      remediationSocket: remediation,
      connected: activeSockets.some((socket) => socket.connected),
    });

    return () => {
      for (const socket of activeSockets) {
        socket.disconnect();
      }
    };
  }, [isAuthenticated, token, potatoMode]);

  return (
    <SocketContext.Provider value={sockets}>
      {children}
    </SocketContext.Provider>
  );
}

export function useSockets() {
  return useContext(SocketContext);
}
