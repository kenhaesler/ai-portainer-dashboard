import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSocket = {
  connected: false,
  on: vi.fn(),
  off: vi.fn(),
  disconnect: vi.fn(),
  emit: vi.fn(),
};

let socketIdCounter = 0;

vi.mock('socket.io-client', () => ({
  io: vi.fn(() => {
    socketIdCounter++;
    return {
      ...mockSocket,
      _id: socketIdCounter,
      connected: false,
      on: vi.fn(),
      off: vi.fn(),
      disconnect: vi.fn(),
      emit: vi.fn(),
    };
  }),
}));

import { io } from 'socket.io-client';
import { getSocket, getNamespaceSocket, disconnectAll, _getNamespaceCache } from './socket';

const mockIo = vi.mocked(io);

describe('socket singleton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    socketIdCounter = 0;
    // Reset module state by disconnecting all
    disconnectAll();
  });

  describe('getSocket', () => {
    it('creates a new main socket', () => {
      const socket = getSocket('token-1');
      expect(mockIo).toHaveBeenCalledTimes(1);
      expect(socket).toBeDefined();
    });

    it('reuses existing main socket on subsequent calls', () => {
      const socket1 = getSocket('token-1');
      const socket2 = getSocket('token-1');
      expect(socket1).toBe(socket2);
      expect(mockIo).toHaveBeenCalledTimes(1);
    });
  });

  describe('getNamespaceSocket', () => {
    it('creates a new socket for a namespace', () => {
      const socket = getNamespaceSocket('monitoring', 'token-1');
      expect(mockIo).toHaveBeenCalledWith('/monitoring', expect.any(Object));
      expect(socket).toBeDefined();
    });

    it('reuses connected socket for same namespace+token', () => {
      const socket1 = getNamespaceSocket('monitoring', 'token-1');
      (socket1 as any).connected = true;

      const socket2 = getNamespaceSocket('monitoring', 'token-1');
      expect(socket2).toBe(socket1);
      expect(mockIo).toHaveBeenCalledTimes(1);
    });

    it('reuses disconnected socket for same namespace+token (avoids thrashing)', () => {
      // Socket.io reconnects automatically — we must not replace it with a new
      // instance just because it is temporarily disconnected, otherwise we race
      // with its built-in reconnection timer.
      const socket1 = getNamespaceSocket('monitoring', 'token-1');
      (socket1 as any).connected = false;

      const socket2 = getNamespaceSocket('monitoring', 'token-1');
      expect(socket2).toBe(socket1);
      expect(mockIo).toHaveBeenCalledTimes(1);
    });

    it('creates new socket for different namespace', () => {
      getNamespaceSocket('monitoring', 'token-1');
      getNamespaceSocket('remediation', 'token-1');
      expect(mockIo).toHaveBeenCalledTimes(2);
    });

    it('creates new socket for different token', () => {
      getNamespaceSocket('monitoring', 'token-1');
      getNamespaceSocket('monitoring', 'token-2');
      expect(mockIo).toHaveBeenCalledTimes(2);
    });

    it('creates new socket after explicit client disconnect removes from cache', () => {
      const socket1 = getNamespaceSocket('monitoring', 'token-1');

      // Trigger the 'io client disconnect' handler to evict from cache
      const disconnectHandler = (socket1.on as any).mock.calls.find(
        (call: any[]) => call[0] === 'disconnect'
      )[1];
      disconnectHandler('io client disconnect');

      // Now a new socket should be created
      getNamespaceSocket('monitoring', 'token-1');
      expect(mockIo).toHaveBeenCalledTimes(2);
    });

    it('does not remove from cache on network-error disconnect', () => {
      const socket1 = getNamespaceSocket('monitoring', 'token-1');
      const cache = _getNamespaceCache();
      expect(cache.size).toBe(1);

      // Simulate a transport error (not client-initiated)
      const disconnectHandler = (socket1.on as any).mock.calls.find(
        (call: any[]) => call[0] === 'disconnect'
      )[1];
      disconnectHandler('transport close');

      expect(cache.size).toBe(1);
    });

    it('registers disconnect cleanup handler', () => {
      const socket = getNamespaceSocket('monitoring', 'token-1');
      expect(socket.on).toHaveBeenCalledWith('disconnect', expect.any(Function));
    });

    it('removes from cache on explicit client disconnect', () => {
      const socket = getNamespaceSocket('monitoring', 'token-1');
      const cache = _getNamespaceCache();
      expect(cache.size).toBe(1);

      // Trigger disconnect handler with client-initiated reason
      const disconnectHandler = (socket.on as any).mock.calls.find(
        (call: any[]) => call[0] === 'disconnect'
      )[1];
      disconnectHandler('io client disconnect');

      expect(cache.size).toBe(0);
    });
  });

  describe('disconnectAll', () => {
    it('disconnects all namespace sockets and clears cache', () => {
      const s1 = getNamespaceSocket('monitoring', 'token-1');
      const s2 = getNamespaceSocket('remediation', 'token-1');
      const cache = _getNamespaceCache();
      expect(cache.size).toBe(2);

      disconnectAll();

      expect(s1.disconnect).toHaveBeenCalled();
      expect(s2.disconnect).toHaveBeenCalled();
      expect(cache.size).toBe(0);
    });
  });
});
