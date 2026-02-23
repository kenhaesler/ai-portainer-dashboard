import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';

// ── Hoisted mock references ──
const { mockQuery } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
}));

// ── Module mocks ──
// Kept: app-db-router mock — no PostgreSQL in CI
vi.mock('../db/app-db-router.js', () => ({
  getDbForDomain: () => ({ query: mockQuery }),
}));

// Kept: logger mock — suppresses log output in tests
vi.mock('../utils/logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

// ── Import after mocks ──
import {
  setupMonitoringNamespace,
  broadcastInsight,
  broadcastInsightBatch,
} from './monitoring.js';

// ── Helpers ──

interface MockSocket {
  id: string;
  data: { user: { sub: string } };
  on: ReturnType<typeof vi.fn>;
  emit: ReturnType<typeof vi.fn>;
  join: ReturnType<typeof vi.fn>;
  leave: ReturnType<typeof vi.fn>;
  rooms: Set<string>;
}

function createMockSocket(): {
  socket: MockSocket;
  handlers: Map<string, (...args: any[]) => any>;
} {
  const handlers = new Map<string, (...args: any[]) => any>();
  const socket: MockSocket = {
    id: 'test-socket-1',
    data: { user: { sub: 'test-user' } },
    on: vi.fn((event: string, handler: (...args: any[]) => any) => {
      handlers.set(event, handler);
    }),
    emit: vi.fn(),
    join: vi.fn(),
    leave: vi.fn(),
    rooms: new Set(['test-socket-1']),
  };
  return { socket, handlers };
}

function createMockNamespace() {
  const ns = new EventEmitter() as any;
  const emitCalls: Array<{ room: string; event: string; args: any[] }> = [];

  ns.to = vi.fn((room: string) => ({
    emit: vi.fn((event: string, ...args: any[]) => {
      emitCalls.push({ room, event, args });
    }),
  }));

  return { ns, emitCalls };
}

// ── Tests ──

describe('setupMonitoringNamespace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('insights:history', () => {
    it('fetches insights without severity filter', async () => {
      const rows = [
        { id: 1, severity: 'warning', title: 'High CPU', created_at: '2026-01-01' },
        { id: 2, severity: 'critical', title: 'OOM', created_at: '2026-01-02' },
      ];
      mockQuery.mockResolvedValue(rows);

      const { ns } = createMockNamespace();
      const { socket, handlers } = createMockSocket();

      setupMonitoringNamespace(ns);
      ns.emit('connection', socket);

      const handler = handlers.get('insights:history')!;
      expect(handler).toBeDefined();

      await handler();

      expect(mockQuery).toHaveBeenCalledWith(
        'SELECT * FROM insights ORDER BY created_at DESC LIMIT ?',
        [50],
      );
      expect(socket.emit).toHaveBeenCalledWith('insights:history', { insights: rows });
    });

    it('applies severity filter when provided', async () => {
      mockQuery.mockResolvedValue([]);

      const { ns } = createMockNamespace();
      const { socket, handlers } = createMockSocket();

      setupMonitoringNamespace(ns);
      ns.emit('connection', socket);

      await handlers.get('insights:history')!({ severity: 'critical', limit: 10 });

      expect(mockQuery).toHaveBeenCalledWith(
        'SELECT * FROM insights WHERE severity = ? ORDER BY created_at DESC LIMIT ?',
        ['critical', 10],
      );
      expect(socket.emit).toHaveBeenCalledWith('insights:history', { insights: [] });
    });

    it('uses default limit of 50 when not specified', async () => {
      mockQuery.mockResolvedValue([]);

      const { ns } = createMockNamespace();
      const { socket, handlers } = createMockSocket();

      setupMonitoringNamespace(ns);
      ns.emit('connection', socket);

      await handlers.get('insights:history')!({});

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('LIMIT ?'),
        [50],
      );
    });

    it('emits error on DB failure', async () => {
      mockQuery.mockRejectedValue(new Error('DB connection lost'));

      const { ns } = createMockNamespace();
      const { socket, handlers } = createMockSocket();

      setupMonitoringNamespace(ns);
      ns.emit('connection', socket);

      await handlers.get('insights:history')!();

      expect(socket.emit).toHaveBeenCalledWith('insights:error', {
        error: 'Failed to fetch history',
      });
    });
  });

  describe('investigations:history', () => {
    it('fetches investigations with joined insight fields', async () => {
      const rows = [
        {
          id: 1,
          insight_id: 10,
          insight_title: 'High CPU',
          insight_severity: 'warning',
          insight_category: 'performance',
          created_at: '2026-01-01',
        },
      ];
      mockQuery.mockResolvedValue(rows);

      const { ns } = createMockNamespace();
      const { socket, handlers } = createMockSocket();

      setupMonitoringNamespace(ns);
      ns.emit('connection', socket);

      await handlers.get('investigations:history')!();

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('LEFT JOIN insights'),
        [50],
      );
      expect(socket.emit).toHaveBeenCalledWith('investigations:history', {
        investigations: rows,
      });
    });

    it('respects custom limit', async () => {
      mockQuery.mockResolvedValue([]);

      const { ns } = createMockNamespace();
      const { socket, handlers } = createMockSocket();

      setupMonitoringNamespace(ns);
      ns.emit('connection', socket);

      await handlers.get('investigations:history')!({ limit: 5 });

      expect(mockQuery).toHaveBeenCalledWith(expect.any(String), [5]);
    });

    it('emits error on DB failure', async () => {
      mockQuery.mockRejectedValue(new Error('timeout'));

      const { ns } = createMockNamespace();
      const { socket, handlers } = createMockSocket();

      setupMonitoringNamespace(ns);
      ns.emit('connection', socket);

      await handlers.get('investigations:history')!();

      expect(socket.emit).toHaveBeenCalledWith('investigations:error', {
        error: 'Failed to fetch investigation history',
      });
    });
  });

  describe('insights:subscribe', () => {
    it('joins severity-specific room when severity provided', () => {
      const { ns } = createMockNamespace();
      const { socket, handlers } = createMockSocket();

      setupMonitoringNamespace(ns);
      ns.emit('connection', socket);

      handlers.get('insights:subscribe')!({ severity: 'critical' });

      expect(socket.join).toHaveBeenCalledWith('severity:critical');
    });

    it('joins severity:all room when no severity specified', () => {
      const { ns } = createMockNamespace();
      const { socket, handlers } = createMockSocket();

      setupMonitoringNamespace(ns);
      ns.emit('connection', socket);

      handlers.get('insights:subscribe')!();

      expect(socket.join).toHaveBeenCalledWith('severity:all');
    });

    it('joins severity:all room when data is empty object', () => {
      const { ns } = createMockNamespace();
      const { socket, handlers } = createMockSocket();

      setupMonitoringNamespace(ns);
      ns.emit('connection', socket);

      handlers.get('insights:subscribe')!({});

      expect(socket.join).toHaveBeenCalledWith('severity:all');
    });
  });

  describe('insights:unsubscribe', () => {
    it('leaves all severity rooms', () => {
      const { ns } = createMockNamespace();
      const { socket, handlers } = createMockSocket();

      // Simulate socket being in severity rooms
      socket.rooms.add('severity:critical');
      socket.rooms.add('severity:all');
      socket.rooms.add('some-other-room');

      setupMonitoringNamespace(ns);
      ns.emit('connection', socket);

      handlers.get('insights:unsubscribe')!();

      // Should leave severity rooms but not the socket's own room or other rooms
      expect(socket.leave).toHaveBeenCalledWith('severity:critical');
      expect(socket.leave).toHaveBeenCalledWith('severity:all');
      expect(socket.leave).not.toHaveBeenCalledWith('some-other-room');
      expect(socket.leave).not.toHaveBeenCalledWith('test-socket-1');
    });
  });

  describe('disconnect', () => {
    it('registers disconnect handler', () => {
      const { ns } = createMockNamespace();
      const { socket, handlers } = createMockSocket();

      setupMonitoringNamespace(ns);
      ns.emit('connection', socket);

      expect(handlers.has('disconnect')).toBe(true);
    });
  });
});

describe('broadcastInsight', () => {
  it('emits to severity-specific and severity:all rooms', () => {
    const { ns, emitCalls } = createMockNamespace();
    const insight = { id: 1, severity: 'warning', title: 'High CPU' };

    broadcastInsight(ns, insight);

    expect(ns.to).toHaveBeenCalledWith('severity:warning');
    expect(ns.to).toHaveBeenCalledWith('severity:all');

    const warningEmits = emitCalls.filter(c => c.room === 'severity:warning');
    expect(warningEmits).toHaveLength(1);
    expect(warningEmits[0].event).toBe('insights:new');
    expect(warningEmits[0].args[0]).toEqual(insight);

    const allEmits = emitCalls.filter(c => c.room === 'severity:all');
    expect(allEmits).toHaveLength(1);
    expect(allEmits[0].event).toBe('insights:new');
    expect(allEmits[0].args[0]).toEqual(insight);
  });
});

describe('broadcastInsightBatch', () => {
  it('does nothing for empty array', () => {
    const { ns, emitCalls } = createMockNamespace();

    broadcastInsightBatch(ns, []);

    expect(ns.to).not.toHaveBeenCalled();
    expect(emitCalls).toHaveLength(0);
  });

  it('emits batch event to severity:all and per-severity individual events', () => {
    const { ns, emitCalls } = createMockNamespace();
    const insights = [
      { id: 1, severity: 'warning', title: 'High CPU' },
      { id: 2, severity: 'critical', title: 'OOM' },
      { id: 3, severity: 'warning', title: 'Disk low' },
    ];

    broadcastInsightBatch(ns, insights);

    // Batch event to severity:all
    const batchEmits = emitCalls.filter(
      c => c.room === 'severity:all' && c.event === 'insights:batch',
    );
    expect(batchEmits).toHaveLength(1);
    expect(batchEmits[0].args[0]).toEqual(insights);

    // Per-severity individual events
    const warningEmits = emitCalls.filter(
      c => c.room === 'severity:warning' && c.event === 'insights:new',
    );
    expect(warningEmits).toHaveLength(2);

    const criticalEmits = emitCalls.filter(
      c => c.room === 'severity:critical' && c.event === 'insights:new',
    );
    expect(criticalEmits).toHaveLength(1);
    expect(criticalEmits[0].args[0]).toEqual(insights[1]);
  });
});
