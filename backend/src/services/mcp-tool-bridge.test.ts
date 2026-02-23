import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock mcp-manager
const mockGetAllMcpTools = vi.fn();
const mockExecuteMcpToolCall = vi.fn();

// Kept: mcp-manager mock — external service boundary
vi.mock('./mcp-manager.js', () => ({
  getAllMcpTools: () => mockGetAllMcpTools(),
  executeMcpToolCall: (...args: unknown[]) => mockExecuteMcpToolCall(...args),
}));

// Mock llm-tools
const mockExecuteToolCalls = vi.fn();
// Kept: llm-tools mock — tests control tool definitions
vi.mock('./llm-tools.js', () => ({
  TOOL_DEFINITIONS: [
    {
      name: 'query_containers',
      description: 'Search containers',
      requiresApproval: false,
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Filter by name' },
        },
      },
    },
    {
      name: 'navigate_to',
      description: 'Navigate to a page',
      requiresApproval: false,
      parameters: {
        type: 'object',
        properties: {
          page: { type: 'string', description: 'Page name' },
        },
        required: ['page'],
      },
    },
  ],
  executeToolCalls: (...args: unknown[]) => mockExecuteToolCalls(...args),
}));

import {
  buildMcpToolName,
  parseMcpToolName,
  convertMcpToolToOllama,
  convertBuiltinToolToOllama,
  collectAllTools,
  routeToolCall,
  routeToolCalls,
} from './mcp-tool-bridge.js';

describe('MCP Tool Bridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAllMcpTools.mockReturnValue([]);
  });

  describe('buildMcpToolName / parseMcpToolName', () => {
    it('builds prefixed name', () => {
      expect(buildMcpToolName('filesystem', 'read_file')).toBe('mcp__filesystem__read_file');
    });

    it('parses prefixed name', () => {
      const result = parseMcpToolName('mcp__filesystem__read_file');
      expect(result).toEqual({ serverName: 'filesystem', toolName: 'read_file' });
    });

    it('returns null for non-MCP name', () => {
      expect(parseMcpToolName('query_containers')).toBeNull();
    });

    it('returns null for malformed MCP name', () => {
      expect(parseMcpToolName('mcp__nounderscore')).toBeNull();
    });

    it('handles server names with hyphens', () => {
      const name = buildMcpToolName('my-server', 'do_thing');
      expect(name).toBe('mcp__my-server__do_thing');
      expect(parseMcpToolName(name)).toEqual({ serverName: 'my-server', toolName: 'do_thing' });
    });
  });

  describe('convertMcpToolToOllama', () => {
    it('converts MCP tool to Ollama format', () => {
      const result = convertMcpToolToOllama({
        serverName: 'fs',
        name: 'read_file',
        description: 'Read a file',
        inputSchema: {
          type: 'object',
          properties: { path: { type: 'string' } },
          required: ['path'],
        },
      });

      expect(result).toEqual({
        type: 'function',
        function: {
          name: 'mcp__fs__read_file',
          description: 'Read a file',
          parameters: {
            type: 'object',
            properties: { path: { type: 'string' } },
            required: ['path'],
          },
        },
      });
    });
  });

  describe('convertBuiltinToolToOllama', () => {
    it('wraps built-in tool in Ollama format', () => {
      const result = convertBuiltinToolToOllama({
        name: 'query_containers',
        description: 'Search containers',
        requiresApproval: false,
        parameters: {
          type: 'object',
          properties: { name: { type: 'string', description: 'Filter by name' } },
        },
      });

      expect(result).toEqual({
        type: 'function',
        function: {
          name: 'query_containers',
          description: 'Search containers',
          parameters: {
            type: 'object',
            properties: { name: { type: 'string', description: 'Filter by name' } },
          },
        },
      });
    });
  });

  describe('collectAllTools', () => {
    it('includes both built-in and MCP tools', () => {
      mockGetAllMcpTools.mockReturnValue([
        {
          serverName: 'fs',
          name: 'read_file',
          description: 'Read a file',
          inputSchema: { type: 'object', properties: {} },
        },
      ]);

      const tools = collectAllTools();
      // 2 built-in + 1 MCP
      expect(tools).toHaveLength(3);
      expect(tools.map(t => t.function.name)).toContain('query_containers');
      expect(tools.map(t => t.function.name)).toContain('navigate_to');
      expect(tools.map(t => t.function.name)).toContain('mcp__fs__read_file');
    });

    it('works with no MCP tools', () => {
      mockGetAllMcpTools.mockReturnValue([]);
      const tools = collectAllTools();
      expect(tools).toHaveLength(2); // Just built-in
    });
  });

  describe('routeToolCall', () => {
    it('routes built-in tool calls to executeToolCalls', async () => {
      mockExecuteToolCalls.mockResolvedValue([{
        tool: 'query_containers',
        success: true,
        data: { containers: [] },
      }]);

      const result = await routeToolCall({
        function: { name: 'query_containers', arguments: { name: 'nginx' } },
      });

      expect(mockExecuteToolCalls).toHaveBeenCalledWith([{
        tool: 'query_containers',
        arguments: { name: 'nginx' },
      }]);
      expect(result.success).toBe(true);
    });

    it('routes MCP tool calls to executeMcpToolCall', async () => {
      mockExecuteMcpToolCall.mockResolvedValue('file contents');

      const result = await routeToolCall({
        function: { name: 'mcp__fs__read_file', arguments: { path: '/tmp/test' } },
      });

      expect(mockExecuteMcpToolCall).toHaveBeenCalledWith('fs', 'read_file', { path: '/tmp/test' });
      expect(result).toEqual({
        tool: 'mcp__fs__read_file',
        success: true,
        data: 'file contents',
      });
    });

    it('handles MCP tool call errors', async () => {
      mockExecuteMcpToolCall.mockRejectedValue(new Error('Server down'));

      const result = await routeToolCall({
        function: { name: 'mcp__fs__read_file', arguments: {} },
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Server down');
    });
  });

  describe('routeToolCalls', () => {
    it('routes multiple calls in parallel', async () => {
      mockExecuteToolCalls.mockResolvedValue([{
        tool: 'query_containers',
        success: true,
        data: { containers: [] },
      }]);
      mockExecuteMcpToolCall.mockResolvedValue('done');

      const results = await routeToolCalls([
        { function: { name: 'query_containers', arguments: {} } },
        { function: { name: 'mcp__fs__read_file', arguments: { path: '/x' } } },
      ]);

      expect(results).toHaveLength(2);
      expect(results[0].tool).toBe('query_containers');
      expect(results[1].tool).toBe('mcp__fs__read_file');
    });
  });
});
