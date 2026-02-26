import { v4 as uuidv4 } from 'uuid';
import { createChildLogger } from '../../../core/utils/logger.js';
import {
  insertAction,
  getAction,
  updateActionStatus,
  updateActionRationale,
  hasPendingAction,
  type ActionInsert,
} from './actions-store.js';
import type { Insight } from '../../../core/models/monitoring.js';
import { eventBus } from '../../../core/services/typed-event-bus.js';
import { getContainerLogs } from '../../../core/portainer/portainer-client.js';
// eslint-disable-next-line boundaries/element-types -- Phase 3: replace with @dashboard/contracts observability interface
import { getLatestMetrics } from '../../observability/index.js';
// eslint-disable-next-line boundaries/element-types, boundaries/entry-point -- Phase 3: replace with @dashboard/contracts AI interface
import { chatStream, isOllamaAvailable } from '../../ai-intelligence/services/llm-client.js';
// eslint-disable-next-line boundaries/element-types, boundaries/entry-point -- Phase 3: replace with @dashboard/contracts AI interface
import { getEffectivePrompt } from '../../ai-intelligence/services/prompt-store.js';
import { broadcastActionUpdate, broadcastNewAction } from '../sockets/remediation.js';
import { getConfig } from '../../../core/config/index.js';

const log = createChildLogger('remediation-service');

type ActionPattern = {
  keywords: RegExp;
  actionType: string;
  rationale: string;
};

/** Action types that directly modify container state. */
const DESTRUCTIVE_ACTION_TYPES = new Set([
  'STOP_CONTAINER',
  'RESTART_CONTAINER',
]);

const DEFAULT_PROTECTED_CONTAINERS = [
  'portainer', 'portainer-agent', 'portainer_agent',
  'redis', 'postgres', 'mysql', 'mariadb', 'mongo', 'mongodb',
  'traefik', 'nginx', 'haproxy', 'caddy',
  'etcd', 'consul', 'vault',
];

export function getProtectedContainerNames(): string[] {
  try {
    const config = getConfig();
    const envValue = (config as Record<string, unknown>).REMEDIATION_PROTECTED_CONTAINERS as string | undefined;
    if (typeof envValue === 'string' && envValue.trim()) {
      return envValue.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    }
  } catch {
    // Config not yet initialized (e.g. during tests); fall through to defaults
  }
  return DEFAULT_PROTECTED_CONTAINERS;
}

export function isProtectedContainer(containerName: string): boolean {
  const protectedNames = getProtectedContainerNames();
  const normalized = containerName.toLowerCase();
  return protectedNames.some((name) => normalized === name || normalized.startsWith(`${name}-`) || normalized.startsWith(`${name}_`));
}

const ACTION_PATTERNS: Array<{
  keywords: RegExp;
  actionType: string;
  rationale: string;
}> = [
  {
    keywords: /unhealthy|health\s*check\s*fail/i,
    actionType: 'RESTART_CONTAINER',
    rationale: 'Container is reporting unhealthy status. Restarting may resolve the issue.',
  },
  {
    keywords: /oom|out\s*of\s*memory|memory\s*limit/i,
    actionType: 'INVESTIGATE',
    rationale: 'Container may be experiencing memory pressure. Check memory limits and usage patterns before taking action.',
  },
  {
    keywords: /restart\s*(loop|count|crash)/i,
    actionType: 'RESTART_CONTAINER',
    rationale: 'Container is in a restart loop. A clean restart may stabilize it.',
  },
  {
    keywords: /high\s*cpu|cpu\s*spike|runaway\s*process/i,
    actionType: 'INVESTIGATE',
    rationale: 'High CPU usage detected. Check for runaway processes and review resource allocation before taking action.',
  },
  {
    keywords: /stopped|exited|not\s*running/i,
    actionType: 'START_CONTAINER',
    rationale: 'Container appears stopped. Starting it may restore service availability.',
  },
];

interface RemediationEvidence {
  logs?: string;
  metrics?: Record<string, number>;
}

export interface RemediationAnalysisResult {
  root_cause: string;
  severity: 'critical' | 'warning' | 'info';
  recommended_actions: Array<{
    action: string;
    priority: 'high' | 'medium' | 'low';
    rationale: string;
  }>;
  log_analysis: string;
  confidence_score: number;
}

function tryParseAnalysisPayload(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // try code-fence extraction below
  }

  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (!fenceMatch) return null;

  try {
    const parsed = JSON.parse(fenceMatch[1]);
    if (parsed && typeof parsed === 'object') {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // fall through to null
  }

  return null;
}

function pickActionPattern(text: string): ActionPattern | null {
  for (const pattern of ACTION_PATTERNS) {
    if (pattern.keywords.test(text)) return pattern;
  }
  return null;
}

function clampConfidenceScore(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0.5;
  return Math.max(0, Math.min(1, value));
}

function parseSeverity(value: unknown): 'critical' | 'warning' | 'info' {
  return value === 'critical' || value === 'warning' || value === 'info' ? value : 'warning';
}

function parseRecommendedActions(value: unknown): RemediationAnalysisResult['recommended_actions'] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const item = entry as Record<string, unknown>;
      const action = typeof item.action === 'string' ? item.action.trim() : '';
      if (!action) return null;
      const priority = item.priority === 'high' || item.priority === 'medium' || item.priority === 'low'
        ? item.priority
        : 'medium';
      const rationale = typeof item.rationale === 'string' && item.rationale.trim()
        ? item.rationale.trim()
        : 'No rationale provided';
      return { action, priority, rationale };
    })
    .filter((entry): entry is RemediationAnalysisResult['recommended_actions'][number] => entry !== null);
}

function validateParsedAnalysis(parsed: Record<string, unknown>): RemediationAnalysisResult {
  const rootCause = typeof parsed.root_cause === 'string' && parsed.root_cause.trim()
    ? parsed.root_cause.trim()
    : 'Unable to determine root cause from current evidence.';
  const logAnalysis = typeof parsed.log_analysis === 'string' ? parsed.log_analysis.trim() : '';

  return {
    root_cause: rootCause,
    severity: parseSeverity(parsed.severity),
    recommended_actions: parseRecommendedActions(parsed.recommended_actions),
    log_analysis: logAnalysis,
    confidence_score: clampConfidenceScore(parsed.confidence_score),
  };
}

export function parseRemediationAnalysis(raw: string): RemediationAnalysisResult {
  const parsedPayload = tryParseAnalysisPayload(raw);
  if (parsedPayload) {
    return validateParsedAnalysis(parsedPayload);
  }

  const fallback = raw.trim();
  return {
    root_cause: fallback || 'Unable to determine root cause from current evidence.',
    severity: 'warning',
    recommended_actions: [],
    log_analysis: '',
    confidence_score: 0.35,
  };
}

export function tryParseRemediationAnalysis(raw: string): RemediationAnalysisResult | null {
  const parsedPayload = tryParseAnalysisPayload(raw);
  if (!parsedPayload) return null;
  return validateParsedAnalysis(parsedPayload);
}

export function buildRemediationPrompt(insight: Insight, evidence: RemediationEvidence): string {
  const parts: string[] = [
    '# Remediation Analysis',
    '',
    '## Insight Context',
    `- Title: ${insight.title}`,
    `- Description: ${insight.description}`,
    `- Severity: ${insight.severity}`,
    `- Container: ${insight.container_name || 'unknown'} (${insight.container_id || 'unknown'})`,
    `- Endpoint: ${insight.endpoint_name || insight.endpoint_id || 'unknown'}`,
    `- Suggested Action: ${insight.suggested_action || 'none'}`,
  ];

  if (evidence.metrics && Object.keys(evidence.metrics).length > 0) {
    parts.push(
      '',
      '## Current Metrics',
      ...Object.entries(evidence.metrics).map(([metric, value]) => `- ${metric}: ${value.toFixed(2)}`),
    );
  }

  if (evidence.logs) {
    parts.push('', '## Recent Logs (last 50 lines, truncated)', '```', evidence.logs, '```');
  }

  parts.push(
    '',
    'Respond with ONLY JSON using this schema:',
    '{',
    '  "root_cause": "Short hypothesis grounded in evidence",',
    '  "severity": "critical | warning | info",',
    '  "recommended_actions": [',
    '    {',
    '      "action": "Specific action recommendation",',
    '      "priority": "high | medium | low",',
    '      "rationale": "Why this action helps"',
    '    }',
    '  ],',
    '  "log_analysis": "What the logs indicate (or empty string)",',
    '  "confidence_score": 0.0',
    '}',
    '',
    'Rules:',
    '- NEVER recommend stopping or restarting containers. Suggest only diagnostic and investigation actions.',
    '- Recommendations must stay advisory/read-only — this system is observer-first.',
    '- Mention uncertainty when evidence is weak.',
    '- Keep output concise and actionable.',
  );

  return parts.join('\n');
}

async function gatherRemediationEvidence(insight: Insight): Promise<RemediationEvidence> {
  const evidence: RemediationEvidence = {};
  const tasks: Promise<void>[] = [];

  if (insight.endpoint_id && insight.container_id) {
    tasks.push((async () => {
      try {
        const logs = await getContainerLogs(insight.endpoint_id!, insight.container_id!, {
          tail: 50,
          timestamps: true,
        });
        evidence.logs = logs.slice(0, 5_120);
      } catch (err) {
        log.warn({ err, containerId: insight.container_id }, 'Failed to gather remediation logs');
      }
    })());
  }

  if (insight.container_id) {
    tasks.push((async () => {
      try {
        evidence.metrics = await getLatestMetrics(insight.container_id!);
      } catch (err) {
        log.warn({ err, containerId: insight.container_id }, 'Failed to gather remediation metrics');
      }
    })());
  }

  await Promise.all(tasks);
  return evidence;
}

function toStoredAnalysis(analysis: RemediationAnalysisResult): string {
  return JSON.stringify(analysis);
}

/** Stricter retry prompt when the first LLM attempt returns unstructured output. */
const RETRY_SYSTEM_PROMPT =
  'You MUST respond with ONLY a valid JSON object. No explanations, no markdown, no code fences. ' +
  'Output exactly one JSON object matching this schema: ' +
  '{"root_cause":"string","severity":"critical|warning|info","recommended_actions":[{"action":"string","priority":"high|medium|low","rationale":"string"}],"log_analysis":"string","confidence_score":0.0}';

async function enrichActionWithLlmAnalysis(
  actionId: string,
  insight: Insight,
): Promise<void> {
  const available = await isOllamaAvailable();
  if (!available) return;

  try {
    const evidence = await gatherRemediationEvidence(insight);
    const prompt = buildRemediationPrompt(insight, evidence);
    const systemPrompt = await getEffectivePrompt('remediation');
    let rawResponse = '';

    await chatStream(
      [{ role: 'user', content: prompt }],
      systemPrompt,
      (chunk) => {
        rawResponse += chunk;
      },
    );

    let parsed = tryParseRemediationAnalysis(rawResponse);

    // Single retry with a stricter prompt when the first attempt returns unstructured output (#746)
    if (!parsed) {
      log.warn({ actionId, insightId: insight.id }, 'First LLM attempt returned unstructured output, retrying with stricter prompt');
      let retryResponse = '';
      await chatStream(
        [
          { role: 'user', content: prompt },
          { role: 'assistant', content: rawResponse },
          { role: 'user', content: 'Your previous response was not valid JSON. Please respond with ONLY a raw JSON object, no markdown fences, no extra text.' },
        ],
        RETRY_SYSTEM_PROMPT,
        (chunk) => {
          retryResponse += chunk;
        },
      );
      parsed = tryParseRemediationAnalysis(retryResponse);

      if (!parsed) {
        log.warn({ actionId, insightId: insight.id }, 'Retry also returned unstructured output, skipping enrichment');
        return;
      }
      log.info({ actionId, insightId: insight.id }, 'Retry succeeded: structured LLM output obtained');
    }

    const updated = await updateActionRationale(actionId, toStoredAnalysis(parsed));
    if (!updated) return;

    const action = await getAction(actionId);
    if (action) {
      broadcastActionUpdate(action as unknown as Record<string, unknown>);
    }
  } catch (err) {
    log.warn({ err, actionId, insightId: insight.id }, 'Failed to enrich remediation action with LLM analysis');
  }
}

export async function suggestAction(
  insight: Insight,
): Promise<{ actionId: string; actionType: string } | null> {
  const textToMatch = `${insight.title} ${insight.description} ${insight.suggested_action || ''}`;
  let pattern = pickActionPattern(textToMatch);
  if (!pattern) return null;

  if (!insight.container_id || !insight.endpoint_id) {
    log.debug(
      { insightId: insight.id },
      'Insight matches action pattern but has no container/endpoint context',
    );
    return null;
  }

  // Safety check: block destructive actions on protected/critical containers
  const containerName = insight.container_name || 'unknown';
  if (DESTRUCTIVE_ACTION_TYPES.has(pattern.actionType) && isProtectedContainer(containerName)) {
    log.warn(
      { containerId: insight.container_id, containerName, actionType: pattern.actionType },
      'Blocked destructive action on protected container — downgrading to INVESTIGATE',
    );
    // Downgrade to investigation instead of blocking entirely
    pattern = {
      ...pattern,
      actionType: 'INVESTIGATE',
      rationale: `Original suggestion (${pattern.actionType}) was blocked because "${containerName}" is a protected infrastructure container. Investigate the issue manually.`,
    };
  }

  if (await hasPendingAction(insight.container_id, pattern.actionType)) {
    log.debug(
      { containerId: insight.container_id, actionType: pattern.actionType },
      'Skipping duplicate pending action',
    );
    return null;
  }

  const actionId = uuidv4();
  const action: ActionInsert = {
    id: actionId,
    insight_id: insight.id,
    endpoint_id: insight.endpoint_id,
    container_id: insight.container_id,
    container_name: insight.container_name || 'unknown',
    action_type: pattern.actionType,
    rationale: pattern.rationale,
  };

  const inserted = await insertAction(action);
  if (!inserted) {
    log.debug(
      { containerId: insight.container_id, actionType: pattern.actionType },
      'Skipped duplicate pending action due to unique constraint',
    );
    return null;
  }

  log.info(
    { actionId, actionType: pattern.actionType, insightId: insight.id },
    'Action suggested',
  );
  broadcastNewAction(action as unknown as Record<string, unknown>);

  // Fire-and-forget enrichment with richer LLM analysis.
  enrichActionWithLlmAnalysis(actionId, insight).catch((err) => {
    log.warn({ err, actionId }, 'Remediation LLM enrichment failed');
  });

  return { actionId, actionType: pattern.actionType };
}

export async function approveAction(actionId: string, username: string): Promise<boolean> {
  const success = await updateActionStatus(actionId, 'approved', { approved_by: username });
  if (success) {
    log.info({ actionId, approvedBy: username }, 'Action approved');
    eventBus.emit('remediation.approved', { actionId, approvedBy: username });
  }
  return success;
}

export async function rejectAction(
  actionId: string,
  username: string,
  reason: string,
): Promise<boolean> {
  const success = await updateActionStatus(actionId, 'rejected', {
    rejected_by: username,
    rejection_reason: reason,
  });
  if (success) {
    log.info({ actionId, rejectedBy: username, reason }, 'Action rejected');
    eventBus.emit('remediation.rejected', { actionId, rejectedBy: username, reason });
  }
  return success;
}
