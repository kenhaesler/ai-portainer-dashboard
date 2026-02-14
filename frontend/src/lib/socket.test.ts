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
  });

  describe('getNamespaceSocket', () => {
    it('creates a new socket for a namespace', () => {
      const socket = getNamespaceSocket('monitoring', 'token-1');
      expect(mockIo).toHaveBeenCalledWith('/monitoring', expect.any(Object));
      expect(socket).toBeDefined();
    });

    it('reuses connected socket for same namespace+token', () => {
      const socket1 = getNamespaceSocket('monitoring', 'token-1');
      // Simulate connected state
      (socket1 as any).connected = true;

      const socket2 = getNamespaceSocket('monitoring', 'token-1');
      // Should return same socket, not create new one
      expect(socket2).toBe(socket1);
      // io should only have been called once
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

    it('creates new socket when existing is disconnected', () => {
      const socket1 = getNamespaceSocket('monitoring', 'token-1');
      // Socket stays disconnected (default)
      (socket1 as any).connected = false;

      getNamespaceSocket('monitoring', 'token-1');
      expect(mockIo).toHaveBeenCalledTimes(2);
    });

    it('registers disconnect cleanup handler', () => {
      const socket = getNamespaceSocket('monitoring', 'token-1');
      expect(socket.on).toHaveBeenCalledWith('disconnect', expect.any(Function));
    });

    it('removes from cache on disconnect', () => {
      const socket = getNamespaceSocket('monitoring', 'token-1');
      const cache = _getNamespaceCache();
      expect(cache.size).toBe(1);

      // Trigger disconnect handler
      const disconnectHandler = (socket.on as any).mock.calls.find(
        (call: any[]) => call[0] === 'disconnect'
      )[1];
      disconnectHandler();

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
