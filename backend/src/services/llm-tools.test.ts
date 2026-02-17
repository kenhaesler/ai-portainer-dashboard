import { describe, it, expect } from 'vitest';
import {
  TOOL_DEFINITIONS,
  parseToolCalls,
  getToolSystemPrompt,
  type ToolCallRequest,
} from './llm-tools.js';

describe('llm-tools', () => {
  describe('TOOL_DEFINITIONS', () => {
    it('should define exactly 9 tools', () => {
      expect(TOOL_DEFINITIONS).toHaveLength(9);
    });

    it('should have unique tool names', () => {
      const names = TOOL_DEFINITIONS.map((t) => t.name);
      expect(new Set(names).size).toBe(names.length);
    });

    it('should include all expected tools', () => {
      const names = TOOL_DEFINITIONS.map((t) => t.name);
      expect(names).toContain('query_containers');
      expect(names).toContain('get_container_metrics');
      expect(names).toContain('list_insights');
      expect(names).toContain('get_container_logs');
      expect(names).toContain('list_anomalies');
      expect(names).toContain('query_traces');
      expect(names).toContain('get_trace_details');
      expect(names).toContain('get_trace_stats');
      expect(names).toContain('navigate_to');
    });

    it('should have valid parameter schemas', () => {
      for (const tool of TOOL_DEFINITIONS) {
        expect(tool.parameters.type).toBe('object');
        expect(typeof tool.parameters.properties).toBe('object');
        expect(tool.description).toBeTruthy();
        expect(tool.name).toBeTruthy();
      }
    });

    it('should mark required parameters correctly', () => {
      const metricsToool = TOOL_DEFINITIONS.find((t) => t.name === 'get_container_metrics');
      expect(metricsToool?.parameters.required).toContain('container_name');

      const logsToolDef = TOOL_DEFINITIONS.find((t) => t.name === 'get_container_logs');
      expect(logsToolDef?.parameters.required).toContain('container_name');

      const navTool = TOOL_DEFINITIONS.find((t) => t.name === 'navigate_to');
      expect(navTool?.parameters.required).toContain('page');

      const traceDetailsTool = TOOL_DEFINITIONS.find((t) => t.name === 'get_trace_details');
      expect(traceDetailsTool?.parameters.required).toContain('trace_id');
    });

    it('should include trace-explorer in navigate_to page enum', () => {
      const navTool = TOOL_DEFINITIONS.find((t) => t.name === 'navigate_to');
      const pageParam = navTool?.parameters.properties.page;
      expect(pageParam?.enum).toContain('trace-explorer');
    });
  });

  describe('getToolSystemPrompt', () => {
    it('should return a non-empty string', () => {
      const prompt = getToolSystemPrompt();
      expect(prompt).toBeTruthy();
      expect(typeof prompt).toBe('string');
    });

    it('should mention all tool names', () => {
      const prompt = getToolSystemPrompt();
      for (const tool of TOOL_DEFINITIONS) {
        expect(prompt).toContain(tool.name);
      }
    });

    it('should include tool_calls format instructions', () => {
      const prompt = getToolSystemPrompt();
      expect(prompt).toContain('tool_calls');
      expect(prompt).toContain('tool_name');
    });

    it('should mention read-only constraint', () => {
      const prompt = getToolSystemPrompt();
      expect(prompt).toContain('read-only');
    });
  });

  describe('parseToolCalls', () => {
    it('should parse valid direct JSON tool calls', () => {
      const input = '{"tool_calls": [{"tool": "query_containers", "arguments": {"state": "running"}}]}';
      const result = parseToolCalls(input);
      expect(result).toHaveLength(1);
      expect(result![0].tool).toBe('query_containers');
      expect(result![0].arguments).toEqual({ state: 'running' });
    });

    it('should parse multiple tool calls', () => {
      const input = JSON.stringify({
        tool_calls: [
          { tool: 'query_containers', arguments: { state: 'running' } },
          { tool: 'list_insights', arguments: { severity: 'critical' } },
        ],
      });
      const result = parseToolCalls(input);
      expect(result).toHaveLength(2);
      expect(result![0].tool).toBe('query_containers');
      expect(result![1].tool).toBe('list_insights');
    });

    it('should unwrap nested tool_calls wrapper format', () => {
      const input = JSON.stringify({
        tool_calls: [
          {
            tool: 'tool_calls',
            arguments: {
              tool_calls: [
                {
                  tool: 'list_insights',
                  arguments: {
                    severity: 'critical',
                    limit: 10,
                    acknowledged: 'false',
                  },
                },
              ],
            },
          },
        ],
      });
      const result = parseToolCalls(input);
      expect(result).toHaveLength(1);
      expect(result![0].tool).toBe('list_insights');
      expect(result![0].arguments).toEqual({
        severity: 'critical',
        limit: 10,
        acknowledged: 'false',
      });
    });

    it('should parse tool calls from markdown code blocks', () => {
      const input = `Let me look that up for you.

\`\`\`json
{"tool_calls": [{"tool": "list_anomalies", "arguments": {"limit": "10"}}]}
\`\`\``;
      const result = parseToolCalls(input);
      expect(result).toHaveLength(1);
      expect(result![0].tool).toBe('list_anomalies');
    });

    it('should parse tool calls from inline JSON', () => {
      const input = 'I will query the containers: {"tool_calls": [{"tool": "query_containers", "arguments": {}}]}';
      const result = parseToolCalls(input);
      expect(result).toHaveLength(1);
      expect(result![0].tool).toBe('query_containers');
    });

    it('should return null for plain text responses', () => {
      const input = 'Here is a list of your running containers:\n- web-app\n- database';
      const result = parseToolCalls(input);
      expect(result).toBeNull();
    });

    it('should return null for invalid JSON', () => {
      const input = '{"tool_calls": [invalid json]}';
      const result = parseToolCalls(input);
      expect(result).toBeNull();
    });

    it('should recover truncated tool call JSON missing closing brackets', () => {
      const input = '{"tool_calls":[{"tool":"get_container_logs","arguments":{"container_name":"backend","tail":50}}]';
      const result = parseToolCalls(input);
      expect(result).toHaveLength(1);
      expect(result![0].tool).toBe('get_container_logs');
      expect(result![0].arguments).toEqual({ container_name: 'backend', tail: 50 });
    });

    it('should reject unknown tool names', () => {
      const input = '{"tool_calls": [{"tool": "delete_container", "arguments": {}}]}';
      const result = parseToolCalls(input);
      expect(result).toBeNull();
    });

    it('should filter out unknown tools but keep valid ones', () => {
      const input = JSON.stringify({
        tool_calls: [
          { tool: 'query_containers', arguments: {} },
          { tool: 'unknown_tool', arguments: {} },
        ],
      });
      const result = parseToolCalls(input);
      expect(result).toHaveLength(1);
      expect(result![0].tool).toBe('query_containers');
    });

    it('should handle missing arguments gracefully', () => {
      const input = '{"tool_calls": [{"tool": "query_containers"}]}';
      const result = parseToolCalls(input);
      expect(result).toHaveLength(1);
      expect(result![0].arguments).toEqual({});
    });

    it('should return null for empty tool_calls array', () => {
      const input = '{"tool_calls": []}';
      const result = parseToolCalls(input);
      expect(result).toBeNull();
    });

    it('should parse trace tool calls', () => {
      const input = JSON.stringify({
        tool_calls: [{ tool: 'query_traces', arguments: { status: 'error', time_range: '1h' } }],
      });
      const result = parseToolCalls(input);
      expect(result).toHaveLength(1);
      expect(result![0].tool).toBe('query_traces');
      expect(result![0].arguments).toEqual({ status: 'error', time_range: '1h' });
    });

    it('should parse get_trace_details tool call', () => {
      const input = JSON.stringify({
        tool_calls: [{ tool: 'get_trace_details', arguments: { trace_id: 'abc-123' } }],
      });
      const result = parseToolCalls(input);
      expect(result).toHaveLength(1);
      expect(result![0].tool).toBe('get_trace_details');
    });

    it('should parse get_trace_stats tool call', () => {
      const input = JSON.stringify({
        tool_calls: [{ tool: 'get_trace_stats', arguments: {} }],
      });
      const result = parseToolCalls(input);
      expect(result).toHaveLength(1);
      expect(result![0].tool).toBe('get_trace_stats');
    });

    it('should parse function-style tool calls with string arguments', () => {
      const input = JSON.stringify({
        tool_calls: [
          {
            function: {
              name: 'list_anomalies',
              arguments: '{"limit":"5"}',
            },
          },
        ],
      });
      const result = parseToolCalls(input);
      expect(result).toHaveLength(1);
      expect(result![0].tool).toBe('list_anomalies');
      expect(result![0].arguments).toEqual({ limit: '5' });
    });

    it('should handle whitespace and newlines in JSON', () => {
      const input = `{
        "tool_calls": [
          {
            "tool": "navigate_to",
            "arguments": {
              "page": "ai-monitor"
            }
          }
        ]
      }`;
      const result = parseToolCalls(input);
      expect(result).toHaveLength(1);
      expect(result![0].tool).toBe('navigate_to');
      expect(result![0].arguments).toEqual({ page: 'ai-monitor' });
    });

    it('should recognize MCP-prefixed tool names', () => {
      const input = JSON.stringify({
        tool_calls: [
          { tool: 'mcp__kali-mcp__run_allowed', arguments: { cmd: 'nmap -sV 172.20.0.5', timeout_sec: 60 } },
        ],
      });
      const result = parseToolCalls(input);
      expect(result).toHaveLength(1);
      expect(result![0].tool).toBe('mcp__kali-mcp__run_allowed');
      expect(result![0].arguments).toEqual({ cmd: 'nmap -sV 172.20.0.5', timeout_sec: 60 });
    });

    it('should recognize MCP tool calls inside markdown code blocks', () => {
      const input = '```json\n{"tool_calls": [{"tool": "mcp__kali-mcp__run_allowed", "arguments": {"cmd": "whoami"}}]}\n```';
      const result = parseToolCalls(input);
      expect(result).toHaveLength(1);
      expect(result![0].tool).toBe('mcp__kali-mcp__run_allowed');
    });

    it('should reject invalid MCP-prefixed names missing second separator', () => {
      const input = JSON.stringify({
        tool_calls: [{ tool: 'mcp__noseparator', arguments: {} }],
      });
      const result = parseToolCalls(input);
      expect(result).toBeNull();
    });
  });
});
