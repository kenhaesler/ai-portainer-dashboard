import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { Server } from 'socket.io';
import { IncomingMessage } from 'http';
import { verifyJwt } from '../utils/crypto.js';
import { createChildLogger } from '../utils/logger.js';
import { getSession } from '../services/session-store.js';
import { getUserById } from '../services/user-store.js';
import { DEV_ALLOWED_ORIGINS } from './dev-origins.js';
import { getAllowedOrigins } from './allowed-origins.js';

const log = createChildLogger('socket.io');

/** How often live sockets re-validate their session/role (ms). */
export const SOCKET_REVALIDATE_INTERVAL_MS = 60_000;

/**
 * Decide whether a live socket should be torn down. Socket auth/authz only runs
 * at handshake time, so without this a logged-out / demoted / deleted user keeps
 * full socket access until the JWT expires (REST re-checks every request).
 *
 * Exported as a pure function for testing.
 */
export function socketRevalidationVerdict(
  session: { user_id: string } | null | undefined,
  expectedSub: string,
  requireAdmin: boolean,
  dbRole: string | undefined,
): 'ok' | 'session-invalid' | 'role-lost' {
  if (!session || session.user_id !== expectedSub) return 'session-invalid';
  if (requireAdmin && dbRole !== 'admin') return 'role-lost';
  return 'ok';
}

interface SocketUser {
  sub: string;
  username: string;
  sessionId: string;
  role?: string;
}

export async function authenticateSocketToken(token: unknown): Promise<SocketUser | null> {
  if (typeof token !== 'string' || token.length === 0) {
    return null;
  }

  const payload = await verifyJwt(token);
  if (!payload?.sessionId) {
    return null;
  }

  const session = await getSession(payload.sessionId);
  if (!session) {
    return null;
  }

  if (session.user_id !== payload.sub || session.username !== payload.username) {
    return null;
  }

  return {
    sub: payload.sub,
    username: payload.username,
    sessionId: payload.sessionId,
    role: payload.role,
  };
}

/**
 * Engine.IO-level request filter. Rejects HTTP requests that do not carry
 * a valid JWT in the `token` query parameter. This runs *before* any
 * transport session is allocated, preventing unauthenticated clients from
 * consuming server resources (H-02 defence-in-depth).
 */
export async function verifyTransportRequest(
  req: IncomingMessage,
  callback: (err: string | null | undefined, success: boolean) => void,
): Promise<void> {
  try {
    const url = new URL(req.url ?? '', 'http://localhost');
    const token = url.searchParams.get('token');
    if (!token) {
      callback('Authentication required', false);
      return;
    }

    const payload = await verifyJwt(token);
    if (!payload?.sessionId) {
      callback('Invalid or expired token', false);
      return;
    }

    const session = await getSession(payload.sessionId);
    if (!session || session.user_id !== payload.sub || session.username !== payload.username) {
      callback('Session invalid or revoked', false);
      return;
    }

    callback(null, true);
  } catch {
    callback('Authentication failed', false);
  }
}

async function socketIoPlugin(fastify: FastifyInstance) {
  const io = new Server(fastify.server, {
    allowRequest: verifyTransportRequest as unknown as Server['opts']['allowRequest'],
    cors: {
      // Same source of truth as packages/core/src/plugins/cors.ts —
      // CORS_ALLOWED_ORIGINS (parsed + validated at boot) drives both REST
      // and WebSocket CORS. When unset in production, getAllowedOrigins()
      // returns false, preserving the legacy "no cross-origin" default.
      origin: process.env.NODE_ENV === 'production'
        ? getAllowedOrigins()
        : DEV_ALLOWED_ORIGINS,
      credentials: true,
    },
    transports: ['websocket', 'polling'],
    // Enable per-message deflate for WebSocket compression
    perMessageDeflate: {
      threshold: 256, // Only compress messages > 256 bytes
      zlibDeflateOptions: { level: 4 }, // Balance speed vs compression
    },
    // Prefer WebSocket — skip polling upgrade delay
    allowUpgrades: true,
    upgradeTimeout: 10_000,
    // Connection tuning
    pingInterval: 25_000,
    pingTimeout: 20_000,
    maxHttpBufferSize: 1e6, // 1MB max message size
    // Enable connection state recovery for seamless reconnects
    connectionStateRecovery: {
      maxDisconnectionDuration: 2 * 60 * 1000, // 2 minutes
    },
  });

  // JWT auth middleware
  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) {
      return next(new Error('Authentication required'));
    }

    const user = await authenticateSocketToken(token);
    if (!user) {
      return next(new Error('Invalid, expired, or revoked token'));
    }
    socket.data.user = user;
    next();
  });

  io.on('connection', (socket) => {
    log.info({ userId: socket.data.user?.sub }, 'Client connected');
    socket.on('disconnect', (reason) => {
      log.info({ userId: socket.data.user?.sub, reason }, 'Client disconnected');
    });
  });

  // Create namespaces
  const llmNamespace = io.of('/llm');
  const monitoringNamespace = io.of('/monitoring');
  const remediationNamespace = io.of('/remediation');

  // Apply auth to all namespaces
  for (const ns of [llmNamespace, monitoringNamespace, remediationNamespace]) {
    ns.use(async (socket, next) => {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error('Authentication required'));
      const user = await authenticateSocketToken(token);
      if (!user) return next(new Error('Invalid, expired, or revoked token'));
      socket.data.user = user;
      next();
    });
  }

  // Remediation namespace requires admin role
  remediationNamespace.use((socket, next) => {
    if (socket.data.user?.role !== 'admin') {
      return next(new Error('Admin role required'));
    }
    next();
  });

  // Periodic live re-validation. Handshake auth runs once; this catches a
  // session that is later revoked (logout, admin force-revoke, user deletion,
  // OIDC group-mapping change) or an admin demoted out of the remediation role,
  // disconnecting the socket instead of letting it survive for the full JWT TTL.
  for (const ns of [llmNamespace, monitoringNamespace, remediationNamespace]) {
    const requireAdmin = ns === remediationNamespace;
    ns.on('connection', (socket) => {
      const user = socket.data.user as SocketUser | undefined;
      if (!user) return;
      const timer = setInterval(() => {
        void (async () => {
          try {
            const session = await getSession(user.sessionId);
            const dbUser = requireAdmin ? await getUserById(user.sub) : undefined;
            const verdict = socketRevalidationVerdict(session, user.sub, requireAdmin, dbUser?.role);
            if (verdict !== 'ok') {
              log.info({ userId: user.sub, ns: ns.name, verdict }, 'Disconnecting socket on revalidation');
              socket.disconnect(true);
            }
          } catch (err) {
            log.warn({ err: (err as Error).message, userId: user.sub }, 'Socket revalidation check failed');
          }
        })();
      }, SOCKET_REVALIDATE_INTERVAL_MS);
      // Don't keep the event loop alive solely for this timer.
      timer.unref?.();
      socket.on('disconnect', () => clearInterval(timer));
    });
  }

  fastify.decorate('io', io);
  fastify.decorate('ioNamespaces', {
    llm: llmNamespace,
    monitoring: monitoringNamespace,
    remediation: remediationNamespace,
  });

  fastify.addHook('onClose', async () => {
    io.close();
  });
}

export default fp(socketIoPlugin, { name: 'socket-io' });

declare module 'fastify' {
  interface FastifyInstance {
    io: Server;
    ioNamespaces: {
      llm: ReturnType<Server['of']>;
      monitoring: ReturnType<Server['of']>;
      remediation: ReturnType<Server['of']>;
    };
  }
}
