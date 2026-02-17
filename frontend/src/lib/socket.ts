import { io, Socket } from 'socket.io-client';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || '';

let mainSocket: Socket | null = null;
const namespaceCache = new Map<string, Socket>();

function cacheKey(namespace: string, token: string): string {
  return `${namespace}:${token}`;
}

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
  const key = cacheKey(namespace, token);
  const existing = namespaceCache.get(key);
  if (existing?.connected) return existing;

  // Clean up stale entry if it exists but is disconnected
  if (existing) {
    namespaceCache.delete(key);
  }

  const socket = io(`${SOCKET_URL}/${namespace}`, {
    auth: { token },
    query: { token },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1000,
  });

  namespaceCache.set(key, socket);

  socket.on('disconnect', () => {
    namespaceCache.delete(key);
  });

  return socket;
}

export function disconnectAll() {
  mainSocket?.disconnect();
  mainSocket = null;

  for (const socket of namespaceCache.values()) {
    socket.disconnect();
  }
  namespaceCache.clear();
}

/** Exposed for testing only */
export function _getNamespaceCache(): Map<string, Socket> {
  return namespaceCache;
}
