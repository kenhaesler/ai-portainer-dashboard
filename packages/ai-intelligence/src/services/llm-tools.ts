import * as portainer from '@dashboard/core/portainer/portainer-client.js';
import { cachedFetch, getCacheKey, TTL } from '@dashboard/core/portainer/portainer-cache.js';
import { normalizeContainer, normalizeEndpoint } from '@dashboard/core/portainer/portainer-normalizers.js';
import { getDbForDomain } from '@dashboard/core/db/app-db-router.js';
import { getMetricsDb } from '@dashboard/core/db/timescale.js';
import { getTraces, getTrace, getTraceSummary } from '@dashboard/core/tracing/trace-store.js';
import { scrubPii } from '@dashboard/core/utils/pii-scrubber.js';
import { z } from 'zod/v4';
import { createChildLogger } from '@dashboard/core/utils/logger.js';
import { withSpan } from '@dashboard/core/tracing/trace-context.js';
import type { InfrastructureLogsInterface } from '@dashboard/contracts';

const log = createChildLogger('llm-tools');

/** Schema for tool call structure (supports both Ollama and OpenAI-like formats) */
const ToolCallSchema = z.object({
  tool: z.string().optional(),
  arguments: z.record(z.string(), z.unknown()).optional(),
  function: z.object({
    name: z.string(),
    arguments: z.union([z.string(), z.record(z.string(), z.unknown())]).optional(),
  }).optional(),
}).refine(
  (data) => data.tool !== undefined || data.function !== undefined,
  { message: 'Tool call must have either "tool" or "function" field' },
);

/** Check if a tool name is an MCP-prefixed name (e.g. mcp__kali-mcp__run_allowed). */
function isMcpToolName(name: string): boolean {
  if (!name.startsWith('mcp__')) return false;
  return name.indexOf('__', 5) > 5; // must have a second __ separator
}

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
  /** Whether the tool requires explicit user approval before execution (e.g. mutating actions). */
  requiresApproval: boolean;
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
    requiresApproval: false,
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
    requiresApproval: false,
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
    requiresApproval: false,
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
    requiresApproval: false,
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
    requiresApproval: false,
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
    name: 'query_traces',
    requiresApproval: false,
    description:
      'Search API request traces by service, status, time range, or minimum duration. Returns trace summaries grouped by trace ID.',
    parameters: {
      type: 'object',
      properties: {
        service_name: { type: 'string', description: 'Filter by service name (e.g. "api-gateway")' },
        status: { type: 'string', description: 'Filter by trace status', enum: ['ok', 'error'] },
        time_range: { type: 'string', description: 'Time range (e.g. "1h", "6h", "24h", "7d"). Default: "24h"' },
        min_duration_ms: { type: 'string', description: 'Minimum duration in milliseconds to filter slow requests' },
        limit: { type: 'string', description: 'Maximum number of traces to return (default 20)' },
      },
    },
  },
  {
    name: 'get_trace_details',
    requiresApproval: false,
    description:
      'Get the full span tree for a specific trace ID. Returns all spans ordered by start time.',
    parameters: {
      type: 'object',
      properties: {
        trace_id: { type: 'string', description: 'The trace ID to look up' },
      },
      required: ['trace_id'],
    },
  },
  {
    name: 'get_trace_stats',
    requiresApproval: false,
    description:
      'Get trace summary statistics including total traces, average duration, error rate, and top slowest endpoints.',
    parameters: {
      type: 'object',
      properties: {
        time_range: { type: 'string', description: 'Time range (e.g. "1h", "6h", "24h", "7d"). Default: "24h"' },
      },
    },
  },
  {
    name: 'navigate_to',
    requiresApproval: false,
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
            'trace-explorer',
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

    const pool = await getMetricsDb();
    const { rows: metrics } = await pool.query<{ timestamp: string; value: number }>(
      `SELECT timestamp::text, value FROM metrics
       WHERE container_id = $1 AND metric_type = $2 AND timestamp >= $3
       ORDER BY timestamp ASC
       LIMIT 500`,
      [match.id, metricType, from.toISOString()],
    );

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
    const db = getDbForDomain('insights');
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

    const insights = await db.query<Record<string, unknown>>(`
      SELECT id, severity, category, title, description, suggested_action,
             container_name, endpoint_name, is_acknowledged, created_at
      FROM insights ${where}
      ORDER BY created_at DESC LIMIT ?
    `, [...params, limit]);

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

/**
 * Create a get_container_logs executor with injected infrastructure logs.
 * @param infraLogs - injected dependency to avoid @dashboard/infrastructure import
 */
function makeExecuteGetContainerLogs(
  infraLogs: InfrastructureLogsInterface,
): (args: Record<string, unknown>) => Promise<ToolCallResult> {
  return async function executeGetContainerLogs(
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

      const edgeAsync = await infraLogs.isEdgeAsync(match.endpointId);
      let logs: string;
      let disclaimer = '';

      if (edgeAsync) {
        logs = await infraLogs.getEdgeAsyncContainerLogs(match.endpointId, match.id, { tail });
        disclaimer = '\n\n_Note: These logs were collected asynchronously via an Edge Job. They may not reflect the very latest output._';
      } else {
        logs = await infraLogs.getContainerLogsWithRetry(match.endpointId, match.id, {
          tail,
          timestamps: true,
        });
      }

      let lines = logs.split('\n').filter((line) => line.trim().length > 0);

      if (args.search) {
        const searchLower = String(args.search).toLowerCase();
        lines = lines.filter((line) => line.toLowerCase().includes(searchLower));
      }

      // Scrub logs for PII before sending to LLM
      const scrubbedLogs = scrubPii(lines.slice(-100).join('\n'));

      return {
        tool: 'get_container_logs',
        success: true,
        data: {
          containerName: match.name,
          lineCount: lines.length,
          logs: scrubbedLogs + disclaimer,
        },
      };
    } catch (err) {
      log.error({ err }, 'get_container_logs failed');
      const message = err instanceof Error ? err.message : 'Failed to fetch container logs';
      if (message.includes('tunnel')) {
        return {
          tool: 'get_container_logs',
          success: false,
          error: `${message}. Note: This is an Edge agent — the tunnel may need time to establish. Try again in a few seconds.`,
        };
      }
      return { tool: 'get_container_logs', success: false, error: message };
    }
  };
}

async function executeListAnomalies(
  args: Record<string, unknown>,
): Promise<ToolCallResult> {
  try {
    const limit = Math.min(parseInt(String(args.limit || '20'), 10) || 20, 50);
    const pool = await getMetricsDb();

    const { rows: anomalies } = await pool.query(
      `SELECT m1.container_id, m1.metric_type, m1.value, m1.timestamp::text,
        (SELECT AVG(value) FROM metrics m2
         WHERE m2.container_id = m1.container_id
         AND m2.metric_type = m1.metric_type
         AND m2.timestamp > m1.timestamp - INTERVAL '1 hour'
        ) as avg_value
      FROM metrics m1
      WHERE m1.timestamp > NOW() - INTERVAL '24 hours'
      ORDER BY m1.timestamp DESC
      LIMIT $1`,
      [limit],
    );

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

function parseTimeRange(timeRange: string): Date {
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
    from.setHours(from.getHours() - 24);
  }
  return from;
}

async function executeQueryTraces(
  args: Record<string, unknown>,
): Promise<ToolCallResult> {
  try {
    const timeRange = String(args.time_range || '24h');
    const from = parseTimeRange(timeRange);
    const limit = Math.min(parseInt(String(args.limit || '20'), 10) || 20, 50);

    let traces = await getTraces({
      from: from.toISOString(),
      serviceName: args.service_name ? String(args.service_name) : undefined,
      status: args.status ? String(args.status) : undefined,
      limit,
    });

    if (args.min_duration_ms) {
      const minDuration = parseInt(String(args.min_duration_ms), 10);
      if (!isNaN(minDuration)) {
        traces = traces.filter((t) => (t.duration_ms ?? 0) >= minDuration);
      }
    }

    return {
      tool: 'query_traces',
      success: true,
      data: { traces, count: traces.length, timeRange },
    };
  } catch (err) {
    log.error({ err }, 'query_traces failed');
    return { tool: 'query_traces', success: false, error: 'Failed to query traces' };
  }
}

async function executeGetTraceDetails(
  args: Record<string, unknown>,
): Promise<ToolCallResult> {
  try {
    const traceId = String(args.trace_id || '');
    if (!traceId) {
      return { tool: 'get_trace_details', success: false, error: 'trace_id is required' };
    }

    const spans = await getTrace(traceId);
    if (spans.length === 0) {
      return { tool: 'get_trace_details', success: false, error: `No trace found with ID "${traceId}"` };
    }

    return {
      tool: 'get_trace_details',
      success: true,
      data: { trace_id: traceId, spans, spanCount: spans.length },
    };
  } catch (err) {
    log.error({ err }, 'get_trace_details failed');
    return { tool: 'get_trace_details', success: false, error: 'Failed to fetch trace details' };
  }
}

async function executeGetTraceStats(
  args: Record<string, unknown>,
): Promise<ToolCallResult> {
  try {
    const timeRange = String(args.time_range || '24h');
    const from = parseTimeRange(timeRange);

    const summary = await getTraceSummary(from.toISOString());

    // Get top slowest endpoints
    const tracesDb = getDbForDomain('traces');
    const slowest = await tracesDb.query<Record<string, unknown>>(`
      SELECT name, AVG(duration_ms) as avg_duration_ms, COUNT(*)::integer as call_count,
             CAST(SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS REAL) / COUNT(*) as error_rate
      FROM spans
      WHERE start_time >= ?
      GROUP BY name
      ORDER BY AVG(duration_ms) DESC
      LIMIT 10
    `, [from.toISOString()]);

    return {
      tool: 'get_trace_stats',
      success: true,
      data: { ...summary, timeRange, slowestEndpoints: slowest },
    };
  } catch (err) {
    log.error({ err }, 'get_trace_stats failed');
    return { tool: 'get_trace_stats', success: false, error: 'Failed to fetch trace stats' };
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
    'trace-explorer': '/trace-explorer',
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

type ToolExecutor = (args: Record<string, unknown>) => Promise<ToolCallResult> | ToolCallResult;

/**
 * Build the executors map with injected infrastructure logs dependency.
 * @param infraLogs - injected to avoid direct @dashboard/infrastructure import
 */
function buildExecutors(infraLogs: InfrastructureLogsInterface): Record<string, ToolExecutor> {
  return {
    query_containers: executeQueryContainers,
    get_container_metrics: executeGetContainerMetrics,
    list_insights: executeListInsights,
    get_container_logs: makeExecuteGetContainerLogs(infraLogs),
    list_anomalies: executeListAnomalies,
    query_traces: executeQueryTraces,
    get_trace_details: executeGetTraceDetails,
    get_trace_stats: executeGetTraceStats,
    navigate_to: executeNavigateTo,
  };
}

export async function executeToolCalls(
  calls: ToolCallRequest[],
  infraLogs: InfrastructureLogsInterface,
): Promise<ToolCallResult[]> {
  const executors = buildExecutors(infraLogs);
  return withSpan('llm-tools.execute', 'llm-tool-executor', 'internal', async () => {
    const results: ToolCallResult[] = [];
    for (const call of calls) {
      // MCP tools must be routed through routeToolCalls in mcp-tool-bridge,
      // not executed directly. Reject them here as a defense-in-depth measure.
      if (isMcpToolName(call.tool)) {
        log.warn({ tool: call.tool }, 'MCP tool routed to executeToolCalls instead of routeToolCalls');
        results.push({
          tool: call.tool,
          success: false,
          error: `MCP tool "${call.tool}" must be executed through the MCP bridge.`,
        });
        continue;
      }

      const toolDef = TOOL_DEFINITIONS.find((t) => t.name === call.tool);

      // If tool requires approval, it cannot be executed via this direct path
      // (This should be handled by the Socket.IO layer which asks the user)
      if (toolDef?.requiresApproval) {
        log.warn({ tool: call.tool }, 'Attempted to execute a tool that requires approval without an approval token');
        results.push({
          tool: call.tool,
          success: false,
          error: `Tool "${call.tool}" requires explicit user approval. Please ask the user to approve this action.`
        });
        continue;
      }

      const executor = executors[call.tool];
      if (!executor) {
        results.push({ tool: call.tool, success: false, error: `Unknown tool: ${call.tool}` });
        continue;
      }
      try {
        const result = await withSpan(
          `llm-tool.${call.tool}`,
          `llm-tool-${call.tool}`,
          'internal',
          () => Promise.resolve(executor(call.arguments)),
        );
        results.push(result);
      } catch (err) {
        log.error({ err, tool: call.tool }, 'Tool execution failed');
        results.push({ tool: call.tool, success: false, error: 'Tool execution failed unexpectedly' });
      }
    }
    return results;
  });
}

// ─── Response Parsing ──────────────────────────────────────────────────

export function parseToolCalls(responseText: string): ToolCallRequest[] | null {
  // Try to find a JSON tool_calls block in the response
  // The LLM should respond with {"tool_calls": [...]} when it wants to use tools

  const trimmed = responseText.trim();

  // Try direct parse first (response is just the JSON)
  const directParsed = tryParseToolCallJson(trimmed);
  if (directParsed?.tool_calls && Array.isArray(directParsed.tool_calls)) {
    return validateToolCalls(directParsed.tool_calls);
  }

  // Try to find JSON block in markdown code fence
  const codeBlockMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (codeBlockMatch) {
    const parsed = tryParseToolCallJson(codeBlockMatch[1].trim());
    if (parsed?.tool_calls && Array.isArray(parsed.tool_calls)) {
      return validateToolCalls(parsed.tool_calls);
    }
  }

  // Try to find inline JSON object with tool_calls
  const jsonMatch = trimmed.match(/\{[\s\S]*"tool_calls"[\s\S]*\}/);
  if (jsonMatch) {
    const parsed = tryParseToolCallJson(jsonMatch[0]);
    if (parsed?.tool_calls && Array.isArray(parsed.tool_calls)) {
      return validateToolCalls(parsed.tool_calls);
    }
  }

  return null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function tryParseToolCallJson(raw: string): any | null {
  try {
    return JSON.parse(raw);
  } catch {
    // Try a best-effort repair when tool-call JSON is truncated mid-stream.
    const repaired = repairTruncatedToolCallJson(raw);
    if (!repaired) return null;
    try {
      return JSON.parse(repaired);
    } catch {
      return null;
    }
  }
}

function repairTruncatedToolCallJson(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed.includes('"tool_calls"')) return null;

  let inString = false;
  let escaped = false;
  const stack: string[] = [];

  for (const ch of trimmed) {
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{' || ch === '[') {
      stack.push(ch);
      continue;
    }
    if (ch === '}' || ch === ']') {
      const last = stack[stack.length - 1];
      if ((ch === '}' && last === '{') || (ch === ']' && last === '[')) {
        stack.pop();
      }
    }
  }

  if (stack.length === 0) return null;

  let repaired = trimmed;
  while (stack.length > 0) {
    const open = stack.pop();
    repaired += open === '{' ? '}' : ']';
  }
  return repaired;
}

function validateToolCalls(calls: unknown[]): ToolCallRequest[] | null {
  const valid: ToolCallRequest[] = [];
  for (const call of calls) {
    const result = ToolCallSchema.safeParse(call);
    if (!result.success) {
      log.debug({ err: result.error, call }, 'Invalid tool call format received from LLM');
      continue;
    }

    const candidate = result.data;

    // Handle nested tool calls wrapper common in some models
    if (
      candidate.tool === 'tool_calls' &&
      candidate.arguments &&
      Array.isArray(candidate.arguments.tool_calls)
    ) {
      const nestedValid = validateToolCalls(candidate.arguments.tool_calls);
      if (nestedValid) valid.push(...nestedValid);
      continue;
    }

    let toolName: string | undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let rawArgs: any = {};

    if (candidate.tool) {
      toolName = candidate.tool;
      rawArgs = candidate.arguments ?? {};
    } else if (candidate.function) {
      toolName = candidate.function.name;
      rawArgs = candidate.function.arguments ?? {};
    }

    // Check against known tool names (executors is not available here without infraLogs;
    // use TOOL_DEFINITIONS as a proxy for known tools)
    const knownTools = new Set(TOOL_DEFINITIONS.map(t => t.name));
    if (!toolName || (!knownTools.has(toolName) && !isMcpToolName(toolName))) {
      log.debug({ toolName }, 'LLM suggested unknown tool');
      continue;
    }

    // Handle stringified arguments (common in OpenAI-style responses)
    if (typeof rawArgs === 'string') {
      try {
        rawArgs = JSON.parse(rawArgs);
      } catch {
        log.warn({ toolName, rawArgs }, 'Failed to parse stringified tool arguments');
        rawArgs = {};
      }
    }

    valid.push({
      tool: toolName,
      arguments: rawArgs as Record<string, unknown>,
    });
  }
  return valid.length > 0 ? valid : null;
}
