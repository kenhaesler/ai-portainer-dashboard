import { createContext, useContext, useEffect, useState } from 'react';
import { Socket } from 'socket.io-client';
import { getNamespaceSocket, disconnectAll } from '@/lib/socket';
import { useAuth } from './auth-provider';

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

    const llm = getNamespaceSocket('llm', token);
    const monitoring = getNamespaceSocket('monitoring', token);
    const remediation = getNamespaceSocket('remediation', token);

    const updateConnected = () => {
      setSockets((prev) => ({
        ...prev,
        connected: llm.connected || monitoring.connected || remediation.connected,
      }));
    };

    for (const s of [llm, monitoring, remediation]) {
      s.on('connect', updateConnected);
      s.on('disconnect', updateConnected);
    }

    setSockets({ llmSocket: llm, monitoringSocket: monitoring, remediationSocket: remediation, connected: false });

    return () => {
      llm.disconnect();
      monitoring.disconnect();
      remediation.disconnect();
    };
  }, [isAuthenticated, token]);

  return (
    <SocketContext.Provider value={sockets}>
      {children}
    </SocketContext.Provider>
  );
}

export function useSockets() {
  return useContext(SocketContext);
}
