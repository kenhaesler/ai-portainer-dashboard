import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { Server } from 'socket.io';
import { verifyJwt } from '../utils/crypto.js';
import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('socket.io');

async function socketIoPlugin(fastify: FastifyInstance) {
  const io = new Server(fastify.server, {
    cors: {
      origin: process.env.NODE_ENV === 'production'
        ? false
        : ['http://localhost:5173', 'http://localhost:8080'],
      credentials: true,
    },
    transports: ['websocket', 'polling'],
  });

  // JWT auth middleware
  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) {
      return next(new Error('Authentication required'));
    }
    const payload = await verifyJwt(token);
    if (!payload) {
      return next(new Error('Invalid or expired token'));
    }
    socket.data.user = {
      sub: payload.sub,
      username: payload.username,
      sessionId: payload.sessionId,
    };
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
      const payload = await verifyJwt(token);
      if (!payload) return next(new Error('Invalid or expired token'));
      socket.data.user = {
        sub: payload.sub,
        username: payload.username,
        sessionId: payload.sessionId,
      };
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
