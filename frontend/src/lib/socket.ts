import { io, Socket } from 'socket.io-client';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || '';

let mainSocket: Socket | null = null;

export function getSocket(token: string): Socket {
  if (mainSocket?.connected) return mainSocket;

  mainSocket = io(SOCKET_URL, {
    auth: { token },
    query: { token },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1000,
  });

  return mainSocket;
}

export function getNamespaceSocket(
  namespace: string,
  token: string
): Socket {
  return io(`${SOCKET_URL}/${namespace}`, {
    auth: { token },
    query: { token },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1000,
  });
}

export function disconnectAll() {
  mainSocket?.disconnect();
  mainSocket = null;
}
