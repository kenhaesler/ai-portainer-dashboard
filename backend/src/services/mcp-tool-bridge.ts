import {
  getAllMcpTools,
  executeMcpToolCall,
  type McpToolDefinition,
} from './mcp-manager.js';
import {
  TOOL_DEFINITIONS,
  executeToolCalls,
  type ToolDefinition,
  type ToolCallResult,
} from './llm-tools.js';
import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('mcp-tool-bridge');

// ─── Types ──────────────────────────────────────────────────────────────

export interface OllamaToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface OllamaToolCall {
  function: {
    name: string;
    arguments: Record<string, unknown>;
  };
}

// ─── Name prefixing ─────────────────────────────────────────────────────

const MCP_PREFIX = 'mcp__';

export function buildMcpToolName(serverName: string, toolName: string): string {
  return `${MCP_PREFIX}${serverName}__${toolName}`;
}

export function parseMcpToolName(prefixedName: string): { serverName: string; toolName: string } | null {
  if (!prefixedName.startsWith(MCP_PREFIX)) return null;
  const rest = prefixedName.slice(MCP_PREFIX.length);
  const sepIdx = rest.indexOf('__');
  if (sepIdx < 0) return null;
  return {
    serverName: rest.slice(0, sepIdx),
    toolName: rest.slice(sepIdx + 2),
  };
}

// ─── Schema Conversion ─────────────────────────────────────────────────

export function convertMcpToolToOllama(tool: McpToolDefinition): OllamaToolDefinition {
  return {
    type: 'function',
    function: {
      name: buildMcpToolName(tool.serverName, tool.name),
      description: tool.description,
      parameters: tool.inputSchema,
    },
  };
}

export function convertBuiltinToolToOllama(tool: ToolDefinition): OllamaToolDefinition {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  };
}

// ─── Collect All Tools ──────────────────────────────────────────────────

export function collectAllTools(): OllamaToolDefinition[] {
  const builtinTools = TOOL_DEFINITIONS.map(convertBuiltinToolToOllama);
  const mcpTools = getAllMcpTools().map(convertMcpToolToOllama);
  return [...builtinTools, ...mcpTools];
}

// ─── Route Tool Calls ───────────────────────────────────────────────────

export async function routeToolCall(call: OllamaToolCall): Promise<ToolCallResult> {
  const name = call.function.name;
  const args = call.function.arguments ?? {};

  const mcpParsed = parseMcpToolName(name);

  if (mcpParsed) {
    // Route to MCP server
    try {
      const result = await executeMcpToolCall(mcpParsed.serverName, mcpParsed.toolName, args);
      return {
        tool: name,
        success: true,
        data: result,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'MCP tool call failed';
      log.error({ err, tool: name }, 'MCP tool call failed');
      return {
        tool: name,
        success: false,
        error: message,
      };
    }
  }

  // Route to built-in tool
  const results = await executeToolCalls([{ tool: name, arguments: args }]);
  return results[0] ?? { tool: name, success: false, error: 'Unknown tool' };
}

export async function routeToolCalls(calls: OllamaToolCall[]): Promise<ToolCallResult[]> {
  return Promise.all(calls.map(routeToolCall));
}
