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
import { getEffectiveMcpConfig } from '../core/services/settings-store.js';
import { createChildLogger } from '../core/utils/logger.js';

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

// ─── System Prompt Supplement ────────────────────────────────────────────

/** Build a text description of connected MCP tools for the system prompt. */
export async function getMcpToolPrompt(): Promise<string> {
  const mcpTools = getAllMcpTools();
  if (mcpTools.length === 0) return '';

  const descriptions = mcpTools.map((tool) => {
    const params = tool.inputSchema.properties
      ? Object.entries(tool.inputSchema.properties as Record<string, { type?: string; description?: string }>)
          .map(([name, prop]) => {
            const req = (tool.inputSchema.required as string[] | undefined)?.includes(name) ? ' (required)' : ' (optional)';
            return `    - ${name}: ${prop.description || prop.type || 'any'}${req}`;
          })
          .join('\n')
      : '    (no parameters)';
    return `- **${tool.name}** (MCP server: ${tool.serverName}): ${tool.description}\n  Parameters:\n${params}`;
  }).join('\n\n');

  const { toolTimeout } = await getEffectiveMcpConfig();

  return `\n\n## External MCP Tools

You also have access to external tools from connected MCP servers. **You MUST use these tools when the user asks you to — do NOT just explain how to use them manually.**

${descriptions}

To call an MCP tool, use the same tool_calls JSON format with the prefixed name \`mcp__<server>__<tool>\`.
For example: \`{"tool_calls": [{"tool": "mcp__kali-mcp__run_allowed", "arguments": {"cmd": "nmap -sV 172.20.0.5", "timeout_sec": ${toolTimeout}}}]}\`
The default timeout is ${toolTimeout} seconds. You do not need to specify timeout_sec unless you want a shorter value.

### Timeout Guidance
If a tool has a \`timeout_sec\` parameter, the default is ${toolTimeout} seconds which is sufficient for most commands. Recommended values:
- Simple commands (whoami, id, cat): ${toolTimeout} (default)
- Network scans (nmap -sn, nmap -p): ${toolTimeout}
- Deep scans (nmap -sV, nmap -A): ${toolTimeout}
- The maximum allowed timeout is ${toolTimeout} seconds

**CRITICAL: When the user asks you to run a command or use an MCP tool, ALWAYS execute it via tool_calls. Never just describe the steps — actually call the tool.**`;
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
