import * as portainer from './portainer-client.js';
import { cachedFetch, getCacheKey, TTL } from './portainer-cache.js';
import { normalizeContainer, normalizeEndpoint } from './portainer-normalizers.js';
import { getDb } from '../db/sqlite.js';
import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('llm-tools');

// ─── Tool Schema Definitions ───────────────────────────────────────────

export interface ToolParameter {
  type: string;
  description: string;
  enum?: string[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, ToolParameter>;
    required?: string[];
  };
}

export interface ToolCallRequest {
  tool: string;
  arguments: Record<string, unknown>;
}

export interface ToolCallResult {
  tool: string;
  success: boolean;
  data?: unknown;
  error?: string;
}

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'query_containers',
    description:
      'Search and filter containers by name, image, state, or endpoint. Returns a list of matching containers with their status, image, endpoint, and ports.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Filter containers whose name contains this string (case-insensitive)' },
        image: { type: 'string', description: 'Filter containers whose image name contains this string' },
        state: { type: 'string', description: 'Filter by container state', enum: ['running', 'stopped', 'paused', 'dead'] },
        endpoint: { type: 'string', description: 'Filter by endpoint name (case-insensitive)' },
        limit: { type: 'string', description: 'Maximum number of results (default 20)' },
      },
    },
  },
  {
    name: 'get_container_metrics',
    description:
      'Fetch CPU, memory, or network metrics for a specific container over a time range. Returns time-series data points.',
    parameters: {
      type: 'object',
      properties: {
        container_name: { type: 'string', description: 'The container name to look up (will find the closest match)' },
        metric_type: { type: 'string', description: 'Type of metric to fetch', enum: ['cpu', 'memory', 'network_rx', 'network_tx'] },
        time_range: { type: 'string', description: 'Time range (e.g. "1h", "6h", "24h", "7d"). Default: "1h"' },
      },
      required: ['container_name'],
    },
  },
  {
    name: 'list_insights',
    description:
      'Query AI-generated monitoring insights filtered by severity or category. Returns recent anomaly detections and their descriptions.',
    parameters: {
      type: 'object',
      properties: {
        severity: { type: 'string', description: 'Filter by severity level', enum: ['critical', 'warning', 'info'] },
        limit: { type: 'string', description: 'Maximum number of insights to return (default 10)' },
        acknowledged: { type: 'string', description: 'Filter by acknowledged status ("true" or "false")' },
      },
    },
  },
  {
    name: 'get_container_logs',
    description:
      'Fetch recent log lines for a container. Useful for debugging issues or checking recent activity.',
    parameters: {
      type: 'object',
      properties: {
        container_name: { type: 'string', description: 'The container name to look up' },
        tail: { type: 'string', description: 'Number of recent log lines to fetch (default 50, max 200)' },
        search: { type: 'string', description: 'Optional text to filter log lines (case-insensitive)' },
      },
      required: ['container_name'],
    },
  },
  {
    name: 'list_anomalies',
    description:
      'Get recent anomaly detections from metrics monitoring. Shows containers with unusual resource usage patterns.',
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'string', description: 'Maximum number of anomaly records (default 20)' },
      },
    },
  },
  {
    name: 'navigate_to',
    description:
      'Generate a deep link URL to a specific dashboard page. Use this when the user wants to go to a particular view.',
    parameters: {
      type: 'object',
      properties: {
        page: {
          type: 'string',
          description: 'The dashboard page to navigate to',
          enum: [
            'dashboard',
            'containers',
            'stacks',
            'images',
            'networks',
            'ai-monitor',
            'remediation',
            'logs',
            'metrics',
            'settings',
            'search',
          ],
        },
        container_name: { type: 'string', description: 'For container-specific pages, the container name to link to' },
      },
      required: ['page'],
    },
  },
];

// ─── Tool System Prompt Section ────────────────────────────────────────

export function getToolSystemPrompt(): string {
  const toolDescriptions = TOOL_DEFINITIONS.map((tool) => {
    const params = Object.entries(tool.parameters.properties)
      .map(([name, prop]) => {
        const req = tool.parameters.required?.includes(name) ? ' (required)' : ' (optional)';
        const enumStr = prop.enum ? ` [options: ${prop.enum.join(', ')}]` : '';
        return `    - ${name}: ${prop.description}${req}${enumStr}`;
      })
      .join('\n');
    return `- **${tool.name}**: ${tool.description}\n  Parameters:\n${params}`;
  }).join('\n\n');

  return `## Available Tools

You have access to the following tools to query live infrastructure data. When a user's question can be better answered with real data, use a tool call instead of relying on the context summary alone.

${toolDescriptions}

## How to Call Tools

To call a tool, respond with ONLY a JSON object in this exact format (no other text before or after):

\`\`\`json
{"tool_calls": [{"tool": "tool_name", "arguments": {"param1": "value1"}}]}
\`\`\`

You may call multiple tools at once by adding multiple objects to the tool_calls array.

After you receive the tool results, provide a natural language response to the user that incorporates the data. Include specific numbers, names, and statuses from the results. Format the data clearly using markdown tables or lists as appropriate.

**Important rules:**
- Only call tools when the user's question requires live or specific data
- For general questions, answer directly from the infrastructure context above
- Never fabricate data — if a tool returns no results, say so
- You may call tools up to 3 times in a conversation turn to gather sufficient data
- All tools are read-only — they cannot modify any containers or infrastructure`;
}

// ─── Tool Executors ────────────────────────────────────────────────────

async function findContainerByName(
  name: string,
): Promise<{ id: string; endpointId: number; name: string } | null> {
  const endpoints = await cachedFetch(
    getCacheKey('endpoints'),
    TTL.ENDPOINTS,
    () => portainer.getEndpoints(),
  );

  const nameLower = name.toLowerCase();
  for (const ep of endpoints) {
    const norm = normalizeEndpoint(ep);
    if (norm.status !== 'up') continue;
    try {
      const containers = await cachedFetch(
        getCacheKey('containers', ep.Id),
        TTL.CONTAINERS,
        () => portainer.getContainers(ep.Id),
      );
      for (const c of containers) {
        const normalized = normalizeContainer(c, ep.Id, ep.Name);
        if (normalized.name.toLowerCase().includes(nameLower)) {
          return { id: normalized.id, endpointId: ep.Id, name: normalized.name };
        }
      }
    } catch {
      // Skip failing endpoints
    }
  }
  return null;
}

async function executeQueryContainers(
  args: Record<string, unknown>,
): Promise<ToolCallResult> {
  try {
    const endpoints = await cachedFetch(
      getCacheKey('endpoints'),
      TTL.ENDPOINTS,
      () => portainer.getEndpoints(),
    );

    const allContainers = [];
    for (const ep of endpoints) {
      const norm = normalizeEndpoint(ep);
      if (norm.status !== 'up') continue;
      try {
        const containers = await cachedFetch(
          getCacheKey('containers', ep.Id),
          TTL.CONTAINERS,
          () => portainer.getContainers(ep.Id),
        );
        allContainers.push(...containers.map((c) => normalizeContainer(c, ep.Id, ep.Name)));
      } catch {
        // Skip failing endpoints
      }
    }

    let filtered = allContainers;

    if (args.name) {
      const nameFilter = String(args.name).toLowerCase();
      filtered = filtered.filter((c) => c.name.toLowerCase().includes(nameFilter));
    }
    if (args.image) {
      const imageFilter = String(args.image).toLowerCase();
      filtered = filtered.filter((c) => c.image.toLowerCase().includes(imageFilter));
    }
    if (args.state) {
      filtered = filtered.filter((c) => c.state === String(args.state));
    }
    if (args.endpoint) {
      const epFilter = String(args.endpoint).toLowerCase();
      filtered = filtered.filter((c) => c.endpointName.toLowerCase().includes(epFilter));
    }

    const limit = Math.min(parseInt(String(args.limit || '20'), 10) || 20, 50);
    const results = filtered.slice(0, limit).map((c) => ({
      name: c.name,
      image: c.image,
      state: c.state,
      status: c.status,
      endpointId: c.endpointId,
      endpointName: c.endpointName,
      ports: c.ports,
      healthStatus: c.healthStatus,
    }));

    return {
      tool: 'query_containers',
      success: true,
      data: { containers: results, total: filtered.length, showing: results.length },
    };
  } catch (err) {
    log.error({ err }, 'query_containers failed');
    return { tool: 'query_containers', success: false, error: 'Failed to query containers' };
  }
}

async function executeGetContainerMetrics(
  args: Record<string, unknown>,
): Promise<ToolCallResult> {
  try {
    const containerName = String(args.container_name || '');
    if (!containerName) {
      return { tool: 'get_container_metrics', success: false, error: 'container_name is required' };
    }

    const match = await findContainerByName(containerName);
    if (!match) {
      return { tool: 'get_container_metrics', success: false, error: `No container found matching "${containerName}"` };
    }

    const metricType = String(args.metric_type || 'cpu');
    const timeRange = String(args.time_range || '1h');

    // Parse time range
    const now = new Date();
    const from = new Date(now);
    const rangeMatch = timeRange.match(/^(\d+)([mhd])$/);
    if (rangeMatch) {
      const value = parseInt(rangeMatch[1], 10);
      const unit = rangeMatch[2];
      switch (unit) {
        case 'm': from.setMinutes(from.getMinutes() - value); break;
        case 'h': from.setHours(from.getHours() - value); break;
        case 'd': from.setDate(from.getDate() - value); break;
      }
    } else {
      from.setHours(from.getHours() - 1);
    }

    const db = getDb();
    const metrics = db.prepare(`
      SELECT timestamp, value FROM metrics
      WHERE container_id = ? AND metric_type = ? AND timestamp >= datetime(?)
      ORDER BY timestamp ASC
      LIMIT 500
    `).all(match.id, metricType, from.toISOString()) as Array<{ timestamp: string; value: number }>;

    // Compute summary stats
    const values = metrics.map((m) => m.value);
    const summary = values.length > 0
      ? {
          min: Math.min(...values),
          max: Math.max(...values),
          avg: values.reduce((a, b) => a + b, 0) / values.length,
          current: values[values.length - 1],
          dataPoints: values.length,
        }
      : null;

    return {
      tool: 'get_container_metrics',
      success: true,
      data: {
        containerName: match.name,
        metricType,
        timeRange,
        summary,
        recentPoints: metrics.slice(-10),
      },
    };
  } catch (err) {
    log.error({ err }, 'get_container_metrics failed');
    return { tool: 'get_container_metrics', success: false, error: 'Failed to fetch metrics' };
  }
}

async function executeListInsights(
  args: Record<string, unknown>,
): Promise<ToolCallResult> {
  try {
    const db = getDb();
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (args.severity) {
      conditions.push('severity = ?');
      params.push(String(args.severity));
    }
    if (args.acknowledged !== undefined) {
      conditions.push('is_acknowledged = ?');
      params.push(String(args.acknowledged) === 'true' ? 1 : 0);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = Math.min(parseInt(String(args.limit || '10'), 10) || 10, 50);

    const insights = db.prepare(`
      SELECT id, severity, category, title, description, suggested_action,
             container_name, endpoint_name, is_acknowledged, created_at
      FROM insights ${where}
      ORDER BY created_at DESC LIMIT ?
    `).all(...params, limit) as Array<Record<string, unknown>>;

    return {
      tool: 'list_insights',
      success: true,
      data: { insights, count: insights.length },
    };
  } catch (err) {
    log.error({ err }, 'list_insights failed');
    return { tool: 'list_insights', success: false, error: 'Failed to fetch insights' };
  }
}

async function executeGetContainerLogs(
  args: Record<string, unknown>,
): Promise<ToolCallResult> {
  try {
    const containerName = String(args.container_name || '');
    if (!containerName) {
      return { tool: 'get_container_logs', success: false, error: 'container_name is required' };
    }

    const match = await findContainerByName(containerName);
    if (!match) {
      return { tool: 'get_container_logs', success: false, error: `No container found matching "${containerName}"` };
    }

    const tail = Math.min(parseInt(String(args.tail || '50'), 10) || 50, 200);
    const logs = await portainer.getContainerLogs(match.endpointId, match.id, {
      tail,
      timestamps: true,
    });

    let lines = logs.split('\n').filter((line) => line.trim().length > 0);

    if (args.search) {
      const searchLower = String(args.search).toLowerCase();
      lines = lines.filter((line) => line.toLowerCase().includes(searchLower));
    }

    return {
      tool: 'get_container_logs',
      success: true,
      data: {
        containerName: match.name,
        lineCount: lines.length,
        logs: lines.slice(-100).join('\n'),
      },
    };
  } catch (err) {
    log.error({ err }, 'get_container_logs failed');
    return { tool: 'get_container_logs', success: false, error: 'Failed to fetch container logs' };
  }
}

async function executeListAnomalies(
  args: Record<string, unknown>,
): Promise<ToolCallResult> {
  try {
    const limit = Math.min(parseInt(String(args.limit || '20'), 10) || 20, 50);
    const db = getDb();

    const anomalies = db.prepare(`
      SELECT m1.container_id, m1.metric_type, m1.value, m1.timestamp,
        (SELECT AVG(value) FROM metrics m2
         WHERE m2.container_id = m1.container_id
         AND m2.metric_type = m1.metric_type
         AND m2.timestamp > datetime(m1.timestamp, '-1 hour')
        ) as avg_value
      FROM metrics m1
      WHERE m1.timestamp > datetime('now', '-24 hours')
      ORDER BY m1.timestamp DESC
      LIMIT ?
    `).all(limit) as Array<Record<string, unknown>>;

    return {
      tool: 'list_anomalies',
      success: true,
      data: { anomalies, count: anomalies.length },
    };
  } catch (err) {
    log.error({ err }, 'list_anomalies failed');
    return { tool: 'list_anomalies', success: false, error: 'Failed to fetch anomalies' };
  }
}

function executeNavigateTo(
  args: Record<string, unknown>,
): ToolCallResult {
  const page = String(args.page || 'dashboard');
  const containerName = args.container_name ? String(args.container_name) : null;

  const routes: Record<string, string> = {
    dashboard: '/',
    containers: '/containers',
    stacks: '/stacks',
    images: '/images',
    networks: '/networks',
    'ai-monitor': '/ai-monitor',
    remediation: '/remediation',
    logs: '/logs',
    metrics: '/metrics',
    settings: '/settings',
    search: '/search',
  };

  const path = routes[page] || '/';
  const url = containerName ? `${path}?name=${encodeURIComponent(containerName)}` : path;

  return {
    tool: 'navigate_to',
    success: true,
    data: { url, page, description: `Navigate to ${page}${containerName ? ` (${containerName})` : ''}` },
  };
}

// ─── Tool Execution Dispatcher ─────────────────────────────────────────

const executors: Record<string, (args: Record<string, unknown>) => Promise<ToolCallResult> | ToolCallResult> = {
  query_containers: executeQueryContainers,
  get_container_metrics: executeGetContainerMetrics,
  list_insights: executeListInsights,
  get_container_logs: executeGetContainerLogs,
  list_anomalies: executeListAnomalies,
  navigate_to: executeNavigateTo,
};

export async function executeToolCalls(
  calls: ToolCallRequest[],
): Promise<ToolCallResult[]> {
  const results: ToolCallResult[] = [];
  for (const call of calls) {
    const executor = executors[call.tool];
    if (!executor) {
      results.push({ tool: call.tool, success: false, error: `Unknown tool: ${call.tool}` });
      continue;
    }
    try {
      const result = await executor(call.arguments);
      results.push(result);
    } catch (err) {
      log.error({ err, tool: call.tool }, 'Tool execution failed');
      results.push({ tool: call.tool, success: false, error: 'Tool execution failed unexpectedly' });
    }
  }
  return results;
}

// ─── Response Parsing ──────────────────────────────────────────────────

export function parseToolCalls(responseText: string): ToolCallRequest[] | null {
  // Try to find a JSON tool_calls block in the response
  // The LLM should respond with {"tool_calls": [...]} when it wants to use tools

  const trimmed = responseText.trim();

  // Try direct parse first (response is just the JSON)
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed.tool_calls && Array.isArray(parsed.tool_calls)) {
      return validateToolCalls(parsed.tool_calls);
    }
  } catch {
    // Not direct JSON
  }

  // Try to find JSON block in markdown code fence
  const codeBlockMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (codeBlockMatch) {
    try {
      const parsed = JSON.parse(codeBlockMatch[1].trim());
      if (parsed.tool_calls && Array.isArray(parsed.tool_calls)) {
        return validateToolCalls(parsed.tool_calls);
      }
    } catch {
      // Invalid JSON in code block
    }
  }

  // Try to find inline JSON object with tool_calls
  const jsonMatch = trimmed.match(/\{[\s\S]*"tool_calls"[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.tool_calls && Array.isArray(parsed.tool_calls)) {
        return validateToolCalls(parsed.tool_calls);
      }
    } catch {
      // Invalid JSON
    }
  }

  return null;
}

function validateToolCalls(calls: unknown[]): ToolCallRequest[] | null {
  const valid: ToolCallRequest[] = [];
  for (const call of calls) {
    if (
      typeof call === 'object' &&
      call !== null &&
      'tool' in call &&
      typeof (call as ToolCallRequest).tool === 'string' &&
      executors[(call as ToolCallRequest).tool]
    ) {
      valid.push({
        tool: (call as ToolCallRequest).tool,
        arguments: (call as ToolCallRequest).arguments || {},
      });
    }
  }
  return valid.length > 0 ? valid : null;
}
