import { io, Socket } from 'socket.io-client';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || '';

let mainSocket: Socket | null = null;
const namespaceCache = new Map<string, Socket>();

function cacheKey(namespace: string, token: string): string {
  return `${namespace}:${token}`;
}

export function getSocket(token: string): Socket {
  if (mainSocket) return mainSocket;

  mainSocket = io(SOCKET_URL, {
    auth: { token },
    query: { token },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1_000,
    reconnectionDelayMax: 30_000,
    randomizationFactor: 0.5,
  });

  return mainSocket;
}

export function getNamespaceSocket(
  namespace: string,
  token: string
): Socket {
  const key = cacheKey(namespace, token);
  const existing = namespaceCache.get(key);

  // Return the existing socket regardless of connection state.
  // Socket.io manages reconnection automatically — creating a new socket
  // while the old one's reconnect timer is running causes thrashing.
  if (existing) return existing;

  const socket = io(`${SOCKET_URL}/${namespace}`, {
    auth: { token },
    query: { token },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1_000,
    reconnectionDelayMax: 30_000,
    randomizationFactor: 0.5,
  });

  namespaceCache.set(key, socket);

  // Only evict from cache on explicit client-initiated disconnect.
  // Network errors and server restarts use reason codes like 'transport close'
  // or 'io server disconnect' — for those, socket.io reconnects automatically.
  socket.on('disconnect', (reason) => {
    if (reason === 'io client disconnect') {
      namespaceCache.delete(key);
    }
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
