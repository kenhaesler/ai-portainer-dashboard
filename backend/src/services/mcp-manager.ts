import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createChildLogger } from '../core/utils/logger.js';
import { getDbForDomain } from '../core/db/app-db-router.js';

const log = createChildLogger('mcp-manager');

// ─── Types ──────────────────────────────────────────────────────────────

export interface McpServerConfig {
  id: number;
  name: string;
  transport: 'stdio' | 'sse' | 'http';
  command?: string | null;
  url?: string | null;
  args?: string | null;       // JSON array
  env?: string | null;        // JSON object
  enabled: boolean;
  disabled_tools?: string | null; // JSON array of tool names
}

export interface McpToolDefinition {
  serverName: string;
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface McpServerStatus {
  name: string;
  transport: 'stdio' | 'sse' | 'http';
  connected: boolean;
  toolCount: number;
  error?: string;
}

interface ConnectedServer {
  client: Client;
  transport: StdioClientTransport | SSEClientTransport | StreamableHTTPClientTransport;
  tools: McpToolDefinition[];
  config: McpServerConfig;
}

// ─── Manager ────────────────────────────────────────────────────────────

const pool = new Map<string, ConnectedServer>();
const errors = new Map<string, string>();

function parseJsonArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseJsonObject(raw: string | null | undefined): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, string>
      : {};
  } catch {
    return {};
  }
}

function createTransport(
  config: McpServerConfig,
): StdioClientTransport | SSEClientTransport | StreamableHTTPClientTransport {
  switch (config.transport) {
    case 'stdio': {
      if (!config.command) throw new Error('stdio transport requires a command');
      const args = parseJsonArray(config.args);
      const env = parseJsonObject(config.env);
      return new StdioClientTransport({
        command: config.command,
        args,
        env: { ...process.env, ...env } as Record<string, string>,
      });
    }
    case 'sse': {
      if (!config.url) throw new Error('SSE transport requires a URL');
      return new SSEClientTransport(new URL(config.url));
    }
    case 'http': {
      if (!config.url) throw new Error('HTTP transport requires a URL');
      return new StreamableHTTPClientTransport(new URL(config.url));
    }
    default:
      throw new Error(`Unknown transport: ${config.transport}`);
  }
}

export async function connectServer(config: McpServerConfig): Promise<void> {
  // Disconnect existing connection if any
  if (pool.has(config.name)) {
    await disconnectServer(config.name);
  }

  errors.delete(config.name);

  const transport = createTransport(config);
  const client = new Client(
    { name: 'ai-portainer-dashboard', version: '1.0.0' },
    { capabilities: {} },
  );

  try {
    await client.connect(transport);

    // Discover tools
    const disabledSet = new Set(parseJsonArray(config.disabled_tools));
    const { tools: rawTools } = await client.listTools();
    const tools: McpToolDefinition[] = (rawTools ?? [])
      .filter((t) => !disabledSet.has(t.name))
      .map((t) => ({
        serverName: config.name,
        name: t.name,
        description: t.description ?? '',
        inputSchema: (t.inputSchema ?? {}) as Record<string, unknown>,
      }));

    pool.set(config.name, { client, transport, tools, config });
    log.info({ server: config.name, toolCount: tools.length }, 'MCP server connected');
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Connection failed';
    errors.set(config.name, message);
    log.error({ err, server: config.name }, 'Failed to connect MCP server');
    // Clean up transport on failure
    try { await transport.close?.(); } catch { /* ignore */ }
    throw err;
  }
}

export async function disconnectServer(name: string): Promise<void> {
  const entry = pool.get(name);
  if (!entry) return;

  try {
    await entry.client.close();
  } catch (err) {
    log.warn({ err, server: name }, 'Error closing MCP client');
  }
  try {
    await entry.transport.close?.();
  } catch (err) {
    log.warn({ err, server: name }, 'Error closing MCP transport');
  }
  pool.delete(name);
  errors.delete(name);
  log.info({ server: name }, 'MCP server disconnected');
}

export async function disconnectAll(): Promise<void> {
  const names = Array.from(pool.keys());
  await Promise.allSettled(names.map((name) => disconnectServer(name)));
}

export function getConnectedServers(): McpServerStatus[] {
  const statuses: McpServerStatus[] = [];

  for (const [name, entry] of pool) {
    statuses.push({
      name,
      transport: entry.config.transport,
      connected: true,
      toolCount: entry.tools.length,
    });
  }

  // Include servers that failed to connect
  for (const [name, error] of errors) {
    if (!pool.has(name)) {
      statuses.push({
        name,
        transport: 'stdio', // fallback
        connected: false,
        toolCount: 0,
        error,
      });
    }
  }

  return statuses;
}

export function isConnected(name: string): boolean {
  return pool.has(name);
}

export function getAllMcpTools(): McpToolDefinition[] {
  const allTools: McpToolDefinition[] = [];
  for (const entry of pool.values()) {
    allTools.push(...entry.tools);
  }
  return allTools;
}

export function getServerTools(name: string): McpToolDefinition[] {
  const entry = pool.get(name);
  return entry ? entry.tools : [];
}

export async function executeMcpToolCall(
  serverName: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<string> {
  const entry = pool.get(serverName);
  if (!entry) {
    throw new Error(`MCP server "${serverName}" is not connected`);
  }

  try {
    const result = await entry.client.callTool({ name: toolName, arguments: args });
    // Extract text content from MCP result
    if (Array.isArray(result.content)) {
      return result.content
        .map((c) => {
          if (typeof c === 'object' && c !== null && 'text' in c) {
            return (c as { text: string }).text;
          }
          return JSON.stringify(c);
        })
        .join('\n');
    }
    return typeof result.content === 'string' ? result.content : JSON.stringify(result.content);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'MCP tool call failed';
    log.error({ err, server: serverName, tool: toolName }, 'MCP tool execution failed');
    throw new Error(message, { cause: err });
  }
}

/** Auto-connect all enabled MCP servers from the database on startup. */
export async function autoConnectAll(): Promise<void> {
  let servers: McpServerConfig[];
  try {
    const mcpDb = getDbForDomain('mcp');
    servers = await mcpDb.query<McpServerConfig>('SELECT * FROM mcp_servers WHERE enabled = true');
  } catch {
    log.debug('MCP servers table not ready yet, skipping auto-connect');
    return;
  }

  if (servers.length === 0) return;

  log.info({ count: servers.length }, 'Auto-connecting enabled MCP servers');
  const results = await Promise.allSettled(
    servers.map((s) => connectServer(s).catch((err) => {
      log.warn({ server: s.name, err: err instanceof Error ? err.message : String(err) }, 'Auto-connect failed');
    })),
  );
  const connected = results.filter((r) => r.status === 'fulfilled').length;
  log.info({ connected, total: servers.length }, 'MCP auto-connect complete');
}

// Export for testing
export function _getPool(): Map<string, ConnectedServer> {
  return pool;
}

export function _getErrors(): Map<string, string> {
  return errors;
}
