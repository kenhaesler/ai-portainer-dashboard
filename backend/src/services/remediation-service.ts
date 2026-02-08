import { v4 as uuidv4 } from 'uuid';
import { createChildLogger } from '../utils/logger.js';
import {
  insertAction,
  getAction,
  updateActionStatus,
  updateActionRationale,
  hasPendingAction,
  type ActionInsert,
} from './actions-store.js';
import type { Insight } from '../models/monitoring.js';
import { emitEvent } from './event-bus.js';
import { getContainerLogs } from './portainer-client.js';
import { getLatestMetrics } from './metrics-store.js';
import { chatStream, isOllamaAvailable } from './llm-client.js';
import { broadcastActionUpdate, broadcastNewAction } from '../sockets/remediation.js';

const log = createChildLogger('remediation-service');

type ActionPattern = {
  keywords: RegExp;
  actionType: string;
  rationale: string;
};

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
    actionType: 'STOP_CONTAINER',
    rationale: 'Container hit memory limit (OOM). Stop it to prevent repeated crashes while investigating.',
  },
  {
    keywords: /restart\s*(loop|count|crash)/i,
    actionType: 'RESTART_CONTAINER',
    rationale: 'Container is in a restart loop. A clean restart may stabilize it.',
  },
  {
    keywords: /high\s*cpu|cpu\s*spike|runaway\s*process/i,
    actionType: 'STOP_CONTAINER',
    rationale: 'High CPU usage detected. Stop the container to mitigate impact while you investigate.',
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
    '- Recommendations must stay advisory/read-only.',
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

async function enrichActionWithLlmAnalysis(
  actionId: string,
  insight: Insight,
): Promise<void> {
  const available = await isOllamaAvailable();
  if (!available) return;

  try {
    const evidence = await gatherRemediationEvidence(insight);
    const prompt = buildRemediationPrompt(insight, evidence);
    let rawResponse = '';

    await chatStream(
      [{ role: 'user', content: prompt }],
      'You are a container remediation analyst. Produce strict JSON only.',
      (chunk) => {
        rawResponse += chunk;
      },
    );

    const parsed = tryParseRemediationAnalysis(rawResponse);
    if (!parsed) {
      log.warn({ actionId, insightId: insight.id }, 'Skipping remediation rationale enrichment due to unstructured LLM output');
      return;
    }
    const updated = updateActionRationale(actionId, toStoredAnalysis(parsed));
    if (!updated) return;

    const action = getAction(actionId);
    if (action) {
      broadcastActionUpdate(action as unknown as Record<string, unknown>);
    }
  } catch (err) {
    log.warn({ err, actionId, insightId: insight.id }, 'Failed to enrich remediation action with LLM analysis');
  }
}

export function suggestAction(
  insight: Insight,
): { actionId: string; actionType: string } | null {
  const textToMatch = `${insight.title} ${insight.description} ${insight.suggested_action || ''}`;
  const pattern = pickActionPattern(textToMatch);
  if (!pattern) return null;

  if (!insight.container_id || !insight.endpoint_id) {
    log.debug(
      { insightId: insight.id },
      'Insight matches action pattern but has no container/endpoint context',
    );
    return null;
  }

  if (hasPendingAction(insight.container_id, pattern.actionType)) {
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

  const inserted = insertAction(action);
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

export function approveAction(actionId: string, username: string): boolean {
  const success = updateActionStatus(actionId, 'approved', { approved_by: username });
  if (success) {
    log.info({ actionId, approvedBy: username }, 'Action approved');
    emitEvent({ type: 'remediation.approved', timestamp: new Date().toISOString(), data: { actionId, approvedBy: username } });
  }
  return success;
}

export function rejectAction(
  actionId: string,
  username: string,
  reason: string,
): boolean {
  const success = updateActionStatus(actionId, 'rejected', {
    rejected_by: username,
    rejection_reason: reason,
  });
  if (success) {
    log.info({ actionId, rejectedBy: username, reason }, 'Action rejected');
    emitEvent({ type: 'remediation.rejected', timestamp: new Date().toISOString(), data: { actionId, rejectedBy: username, reason } });
  }
  return success;
}
