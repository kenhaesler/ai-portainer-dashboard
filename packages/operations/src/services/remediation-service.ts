import { randomUUID } from 'node:crypto';
import { createChildLogger } from '@dashboard/core/utils/logger.js';
import { extractLlmJson } from '@dashboard/core/utils/llm-json.js';
import {
  insertAction,
  getAction,
  updateActionStatus,
  updateActionRationale,
  hasPendingAction,
  type ActionInsert,
} from './actions-store.js';
import type { Insight } from '@dashboard/core/models/monitoring.js';
import { eventBus } from '@dashboard/core/services/typed-event-bus.js';
import { getContainerLogs } from '@dashboard/core/portainer/portainer-client.js';
import type { LLMInterface, MetricsInterface, RationaleSource, RemediationAnalysisResult } from '@dashboard/contracts';

// Re-exported for the historical import path; the canonical shape lives in
// @dashboard/contracts (#1509).
export type { RemediationAnalysisResult, RationaleSource };

let _llm: LLMInterface | null = null;
let _metrics: MetricsInterface | null = null;

/**
 * Initialize remediation dependencies. Must be called before suggestAction is used.
 * Called from the server composition root (app.ts) during startup.
 */
export function initRemediationDeps(llm: LLMInterface, metrics: MetricsInterface): void {
  _llm = llm;
  _metrics = metrics;
}
import { broadcastActionUpdate, broadcastNewAction } from '../sockets/remediation.js';
import { getConfig } from '@dashboard/core/config/index.js';
import { clampConfidenceScore, parseSeverity } from '@dashboard/core/utils/model-confidence.js';

const log = createChildLogger('remediation-service');

type ActionPattern = {
  /** Stable id for the rule that matched, so the UI can group/label by rule. */
  id: string;
  keywords: RegExp;
  actionType: string;
  rationale: string;
  /** Always 'pattern-match' here — these strings are a lookup table, not analysis. */
  source: RationaleSource;
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

/**
 * Fixed keyword→action lookup. Every rationale here is a constant this file
 * ships, not model output — hence `source: 'pattern-match'` on each entry, which
 * travels to the UI so the two can be told apart on screen.
 */
const ACTION_PATTERNS: ActionPattern[] = [
  {
    id: 'unhealthy-status',
    keywords: /unhealthy|health\s*check\s*fail/i,
    actionType: 'RESTART_CONTAINER',
    rationale: 'Container is reporting unhealthy status. Restarting may resolve the issue.',
    source: 'pattern-match',
  },
  {
    id: 'memory-pressure',
    keywords: /oom|out\s*of\s*memory|memory\s*limit/i,
    actionType: 'INVESTIGATE',
    rationale: 'Container may be experiencing memory pressure. Check memory limits and usage patterns before taking action.',
    source: 'pattern-match',
  },
  {
    id: 'restart-loop',
    keywords: /restart\s*(loop|count|crash)/i,
    actionType: 'RESTART_CONTAINER',
    rationale: 'Container is in a restart loop. A clean restart may stabilize it.',
    source: 'pattern-match',
  },
  {
    id: 'high-cpu',
    keywords: /high\s*cpu|cpu\s*spike|runaway\s*process/i,
    actionType: 'INVESTIGATE',
    rationale: 'High CPU usage detected. Check for runaway processes and review resource allocation before taking action.',
    source: 'pattern-match',
  },
  {
    id: 'container-stopped',
    keywords: /stopped|exited|not\s*running/i,
    actionType: 'START_CONTAINER',
    rationale: 'Container appears stopped. Starting it may restore service availability.',
    source: 'pattern-match',
  },
];

/**
 * Classify where an action's stored `rationale` came from.
 *
 * A rationale is either a constant from ACTION_PATTERNS (a plain sentence) or a
 * serialized {@link RemediationAnalysisResult} written by
 * `enrichActionWithLlmAnalysis`. Both are rendered under the same bot icon
 * today; this is the server-side answer to "which one am I looking at".
 */
export function classifyRationaleSource(rationale: string | null | undefined): RationaleSource | null {
  if (!rationale || !rationale.trim()) return null;
  const parsed = tryParseAnalysisPayload(rationale);
  if (parsed && typeof parsed.root_cause === 'string') {
    return parsed.analysis_source === 'pattern-match' ? 'pattern-match' : 'llm-analysis';
  }
  return 'pattern-match';
}

interface RemediationEvidence {
  logs?: string;
  metrics?: Record<string, number>;
}

function tryParseAnalysisPayload(raw: string): Record<string, unknown> | null {
  // Direct JSON or a ```json``` fenced block via the shared extractor (#1512).
  const parsed = extractLlmJson<Record<string, unknown>>(raw);
  return parsed && typeof parsed === 'object' ? parsed : null;
}

function pickActionPattern(text: string): ActionPattern | null {
  for (const pattern of ACTION_PATTERNS) {
    if (pattern.keywords.test(text)) return pattern;
  }
  return null;
}

// `clampConfidenceScore` / `parseSeverity` moved to @dashboard/core so the
// investigation and PCAP analysers can share one rule instead of keeping their
// own copies — they had each kept a `0.5` default, and this file's fix did not
// reach them. Re-exported because this module's path is the one callers and
// tests already use.
export { clampConfidenceScore, parseSeverity };

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
    analysis_source: 'llm-analysis',
  };
}

export function parseRemediationAnalysis(raw: string): RemediationAnalysisResult {
  const parsedPayload = tryParseAnalysisPayload(raw);
  if (parsedPayload) {
    return validateParsedAnalysis(parsedPayload);
  }

  // Unstructured model output: we have prose and nothing else. Severity and
  // confidence are null rather than 0.35/'warning' — the model stated neither,
  // and inventing them puts a number on screen that nothing measured.
  const fallback = raw.trim();
  return {
    root_cause: fallback || 'Unable to determine root cause from current evidence.',
    severity: null,
    recommended_actions: [],
    log_analysis: '',
    confidence_score: null,
    analysis_source: 'llm-analysis',
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
        evidence.metrics = _metrics ? await _metrics.getLatestMetrics(insight.container_id!) : {};
      } catch (err) {
        log.warn({ err, containerId: insight.container_id }, 'Failed to gather remediation metrics');
      }
    })());
  }

  await Promise.all(tasks);
  return evidence;
}

function toStoredAnalysis(analysis: RemediationAnalysisResult): string {
  // `analysis_source` is written explicitly so the stored rationale describes
  // its own provenance, rather than leaving the UI to infer it from the fact
  // that the string happens to parse as JSON.
  return JSON.stringify({ ...analysis, analysis_source: 'llm-analysis' satisfies RationaleSource });
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
  const available = _llm ? await _llm.isAvailable() : false;
  if (!available) return;

  try {
    const evidence = await gatherRemediationEvidence(insight);
    const prompt = buildRemediationPrompt(insight, evidence);
    const systemPrompt = await _llm!.getEffectivePrompt('remediation');
    // Use the return value, not accumulated chunks — chatStream guards the
    // prompt and sanitizes the full response centrally.
    const rawResponse = await _llm!.chatStream(
      [{ role: 'user', content: prompt }],
      systemPrompt,
      () => {},
      'remediation',
    );

    let parsed = tryParseRemediationAnalysis(rawResponse);

    // Single retry with a stricter prompt when the first attempt returns unstructured output (#746)
    if (!parsed) {
      log.warn({ actionId, insightId: insight.id }, 'First LLM attempt returned unstructured output, retrying with stricter prompt');
      const retryResponse = await _llm!.chatStream(
        [
          { role: 'user', content: prompt },
          { role: 'assistant', content: rawResponse },
          { role: 'user', content: 'Your previous response was not valid JSON. Please respond with ONLY a raw JSON object, no markdown fences, no extra text.' },
        ],
        RETRY_SYSTEM_PROMPT,
        () => {},
        'remediation',
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
): Promise<{ actionId: string; actionType: string; rationaleSource: RationaleSource; patternId: string } | null> {
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
      id: `${pattern.id}-downgraded`,
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

  const actionId = randomUUID();
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

  // The rationale stored above is a constant from ACTION_PATTERNS. Say so, so
  // no caller mistakes it for the model's analysis (which may replace it
  // asynchronously via enrichActionWithLlmAnalysis).
  return {
    actionId,
    actionType: pattern.actionType,
    rationaleSource: pattern.source,
    patternId: pattern.id,
  };
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
