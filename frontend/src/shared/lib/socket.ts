import { io, Socket } from 'socket.io-client';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || '';

let mainSocket: Socket | null = null;
const namespaceCache = new Map<string, Socket>();

// One socket per namespace for the life of the session. The token is NOT part
// of the key: keying by token minted three new sockets on every JWT refresh
// and orphaned the old ones, which kept reconnecting with a stale token (#1704).
const socketTokens = new WeakMap<Socket, string>();
// Sockets we are deliberately cycling to present a new token; their
// 'io client disconnect' must not evict them from the cache.
const refreshing = new WeakSet<Socket>();

function applyToken(socket: Socket, token: string): void {
  socket.auth = { token };
  // The server handshake also reads the token from the query string.
  socket.io.opts.query = { token };
  socketTokens.set(socket, token);
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
  const existing = namespaceCache.get(namespace);

  // Return the existing socket regardless of connection state.
  // Socket.io manages reconnection automatically - creating a new socket
  // while the old one's reconnect timer is running causes thrashing.
  if (existing) {
    if (socketTokens.get(existing) !== token) {
      // Token refreshed: reuse the socket, but reconnect once so the handshake
      // (and the server's 60s session re-validation) sees the new token.
      applyToken(existing, token);
      refreshing.add(existing);
      existing.disconnect();
      refreshing.delete(existing);
      existing.connect();
    }
    return existing;
  }

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

  socketTokens.set(socket, token);
  namespaceCache.set(namespace, socket);

  // Only evict from cache on explicit client-initiated disconnect.
  // Network errors and server restarts use reason codes like 'transport close'
  // or 'io server disconnect' — for those, socket.io reconnects automatically.
  socket.on('disconnect', (reason) => {
    if (reason === 'io client disconnect' && !refreshing.has(socket)) {
      namespaceCache.delete(namespace);
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
