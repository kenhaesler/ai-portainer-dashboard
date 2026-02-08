import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { Server } from 'socket.io';
import { IncomingMessage } from 'http';
import { verifyJwt } from '../utils/crypto.js';
import { createChildLogger } from '../utils/logger.js';
import { getSession } from '../services/session-store.js';
import { DEV_ALLOWED_ORIGINS } from './dev-origins.js';

const log = createChildLogger('socket.io');

interface SocketUser {
  sub: string;
  username: string;
  sessionId: string;
}

export async function authenticateSocketToken(token: unknown): Promise<SocketUser | null> {
  if (typeof token !== 'string' || token.length === 0) {
    return null;
  }

  const payload = await verifyJwt(token);
  if (!payload?.sessionId) {
    return null;
  }

  const session = getSession(payload.sessionId);
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

    const session = getSession(payload.sessionId);
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
      origin: process.env.NODE_ENV === 'production'
        ? false
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
