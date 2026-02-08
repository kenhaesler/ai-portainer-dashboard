import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Use vi.hoisted() to create mocks that are accessible inside vi.mock() factory
const {
  mockConnect,
  mockClose,
  mockListTools,
  mockCallTool,
  MockClient,
  mockTransportClose,
  MockStdioTransport,
  MockSSETransport,
  MockHTTPTransport,
} = vi.hoisted(() => {
  const mockConnect = vi.fn();
  const mockClose = vi.fn();
  const mockListTools = vi.fn();
  const mockCallTool = vi.fn();
  const MockClient = vi.fn().mockImplementation(() => ({
    connect: mockConnect,
    close: mockClose,
    listTools: mockListTools,
    callTool: mockCallTool,
  }));
  const mockTransportClose = vi.fn();
  const MockStdioTransport = vi.fn().mockImplementation(() => ({
    close: mockTransportClose,
  }));
  const MockSSETransport = vi.fn().mockImplementation(() => ({
    close: mockTransportClose,
  }));
  const MockHTTPTransport = vi.fn().mockImplementation(() => ({
    close: mockTransportClose,
  }));
  return {
    mockConnect, mockClose, mockListTools, mockCallTool, MockClient,
    mockTransportClose, MockStdioTransport, MockSSETransport, MockHTTPTransport,
  };
});

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: MockClient,
}));
vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: MockStdioTransport,
}));
vi.mock('@modelcontextprotocol/sdk/client/sse.js', () => ({
  SSEClientTransport: MockSSETransport,
}));
vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: MockHTTPTransport,
}));

vi.mock('../utils/logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

import {
  connectServer,
  disconnectServer,
  disconnectAll,
  getConnectedServers,
  isConnected,
  getAllMcpTools,
  getServerTools,
  executeMcpToolCall,
  _getPool,
  _getErrors,
  type McpServerConfig,
} from './mcp-manager.js';

function makeConfig(overrides: Partial<McpServerConfig> = {}): McpServerConfig {
  return {
    id: 1,
    name: 'test-server',
    transport: 'stdio',
    command: 'echo hello',
    url: null,
    args: null,
    env: null,
    enabled: 1,
    disabled_tools: null,
    ...overrides,
  };
}

describe('MCP Manager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Clear the pool and errors between tests
    _getPool().clear();
    _getErrors().clear();
    mockListTools.mockResolvedValue({
      tools: [
        { name: 'read_file', description: 'Read a file', inputSchema: { type: 'object', properties: { path: { type: 'string' } } } },
        { name: 'write_file', description: 'Write a file', inputSchema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } } } },
      ],
    });
    mockConnect.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    _getPool().clear();
    _getErrors().clear();
  });

  describe('connectServer', () => {
    it('connects to a stdio server and discovers tools', async () => {
      const config = makeConfig();
      await connectServer(config);

      expect(MockStdioTransport).toHaveBeenCalledWith({
        command: 'echo hello',
        args: [],
        env: expect.objectContaining({}),
      });
      expect(mockConnect).toHaveBeenCalled();
      expect(mockListTools).toHaveBeenCalled();
      expect(isConnected('test-server')).toBe(true);
      expect(getServerTools('test-server')).toHaveLength(2);
    });

    it('connects to an SSE server', async () => {
      const config = makeConfig({ transport: 'sse', command: null, url: 'http://localhost:3000/sse' });
      await connectServer(config);

      expect(MockSSETransport).toHaveBeenCalled();
      expect(isConnected('test-server')).toBe(true);
    });

    it('connects to an HTTP server', async () => {
      const config = makeConfig({ transport: 'http', command: null, url: 'http://localhost:3000/mcp' });
      await connectServer(config);

      expect(MockHTTPTransport).toHaveBeenCalled();
      expect(isConnected('test-server')).toBe(true);
    });

    it('throws for stdio without command', async () => {
      const config = makeConfig({ command: null });
      await expect(connectServer(config)).rejects.toThrow('stdio transport requires a command');
    });

    it('throws for SSE without URL', async () => {
      const config = makeConfig({ transport: 'sse', command: null, url: null });
      await expect(connectServer(config)).rejects.toThrow('SSE transport requires a URL');
    });

    it('respects disabled_tools filter', async () => {
      const config = makeConfig({ disabled_tools: '["write_file"]' });
      await connectServer(config);

      const tools = getServerTools('test-server');
      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe('read_file');
    });

    it('parses args and env JSON', async () => {
      const config = makeConfig({
        args: '["--flag", "value"]',
        env: '{"MY_VAR": "123"}',
      });
      await connectServer(config);

      expect(MockStdioTransport).toHaveBeenCalledWith({
        command: 'echo hello',
        args: ['--flag', 'value'],
        env: expect.objectContaining({ MY_VAR: '123' }),
      });
    });

    it('stores error on connection failure', async () => {
      mockConnect.mockRejectedValue(new Error('Connection refused'));
      const config = makeConfig();

      await expect(connectServer(config)).rejects.toThrow('Connection refused');
      expect(isConnected('test-server')).toBe(false);
      expect(_getErrors().get('test-server')).toBe('Connection refused');
    });

    it('disconnects existing connection before reconnecting', async () => {
      await connectServer(makeConfig());
      expect(isConnected('test-server')).toBe(true);

      // Reconnect
      await connectServer(makeConfig());
      expect(mockClose).toHaveBeenCalled();
    });
  });

  describe('disconnectServer', () => {
    it('disconnects and removes from pool', async () => {
      await connectServer(makeConfig());
      expect(isConnected('test-server')).toBe(true);

      await disconnectServer('test-server');
      expect(isConnected('test-server')).toBe(false);
      expect(mockClose).toHaveBeenCalled();
    });

    it('no-ops for unknown server', async () => {
      await disconnectServer('unknown');
      // Should not throw
    });
  });

  describe('disconnectAll', () => {
    it('disconnects all connected servers', async () => {
      await connectServer(makeConfig({ name: 'server-a' }));
      await connectServer(makeConfig({ name: 'server-b', id: 2 }));
      expect(_getPool().size).toBe(2);

      await disconnectAll();
      expect(_getPool().size).toBe(0);
    });
  });

  describe('getConnectedServers', () => {
    it('returns connected servers with tool counts', async () => {
      await connectServer(makeConfig());
      const statuses = getConnectedServers();
      expect(statuses).toHaveLength(1);
      expect(statuses[0]).toMatchObject({
        name: 'test-server',
        connected: true,
        toolCount: 2,
      });
    });

    it('includes failed servers with error', async () => {
      mockConnect.mockRejectedValue(new Error('fail'));
      try { await connectServer(makeConfig()); } catch { /* expected */ }

      const statuses = getConnectedServers();
      expect(statuses).toHaveLength(1);
      expect(statuses[0]).toMatchObject({
        name: 'test-server',
        connected: false,
        error: 'fail',
      });
    });
  });

  describe('getAllMcpTools', () => {
    it('aggregates tools from all servers', async () => {
      await connectServer(makeConfig({ name: 'server-a' }));

      mockListTools.mockResolvedValue({
        tools: [{ name: 'custom_tool', description: 'Custom', inputSchema: {} }],
      });
      await connectServer(makeConfig({ name: 'server-b', id: 2 }));

      const tools = getAllMcpTools();
      expect(tools).toHaveLength(3); // 2 from server-a + 1 from server-b
    });
  });

  describe('executeMcpToolCall', () => {
    it('executes tool call on connected server', async () => {
      mockCallTool.mockResolvedValue({
        content: [{ type: 'text', text: 'file contents here' }],
      });
      await connectServer(makeConfig());

      const result = await executeMcpToolCall('test-server', 'read_file', { path: '/tmp/test' });
      expect(result).toBe('file contents here');
      expect(mockCallTool).toHaveBeenCalledWith({ name: 'read_file', arguments: { path: '/tmp/test' } });
    });

    it('throws for disconnected server', async () => {
      await expect(executeMcpToolCall('unknown', 'tool', {})).rejects.toThrow(
        'MCP server "unknown" is not connected',
      );
    });

    it('handles tool execution error', async () => {
      mockCallTool.mockRejectedValue(new Error('Tool failed'));
      await connectServer(makeConfig());

      await expect(executeMcpToolCall('test-server', 'read_file', {})).rejects.toThrow(
        'Tool failed',
      );
    });

    it('handles non-array content', async () => {
      mockCallTool.mockResolvedValue({ content: 'plain text' });
      await connectServer(makeConfig());

      const result = await executeMcpToolCall('test-server', 'read_file', {});
      expect(result).toBe('plain text');
    });
  });
});
