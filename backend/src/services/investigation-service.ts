import { v4 as uuidv4 } from 'uuid';
import type { Namespace } from 'socket.io';
import { getConfig } from '../config/index.js';
import { createChildLogger } from '../utils/logger.js';
import { getContainerLogs, getContainers } from './portainer-client.js';
import { getMetrics, getMovingAverage } from './metrics-store.js';
import { isOllamaAvailable, chatStream } from './llm-client.js';
import { getEffectivePrompt } from './prompt-store.js';
import {
  insertInvestigation,
  updateInvestigationStatus,
  getInvestigation,
  getRecentInvestigationForContainer,
} from './investigation-store.js';
import { generateForecast, type CapacityForecast } from './capacity-forecaster.js';
import type { Insight } from '../models/monitoring.js';
import type { EvidenceSummary, MetricSnapshot, RecommendedAction } from '../models/investigation.js';

const log = createChildLogger('investigation-service');

let investigationNamespace: Namespace | null = null;
let activeInvestigations = 0;
const cooldownMap = new Map<string, number>();

export function setInvestigationNamespace(ns: Namespace): void {
  investigationNamespace = ns;
  log.info('Investigation namespace registered for real-time broadcasting');
}

export interface ParsedInvestigationResult {
  root_cause: string;
  contributing_factors: string[];
  severity_assessment: string;
  recommended_actions: RecommendedAction[];
  confidence_score: number;
  ai_summary: string;
}

export function parseInvestigationResponse(raw: string): ParsedInvestigationResult {
  // Try direct JSON parse
  try {
    const parsed = JSON.parse(raw);
    return validateParsedResult(parsed);
  } catch {
    // not direct JSON
  }

  // Try to extract JSON from markdown code fences
  const jsonMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1]);
      return validateParsedResult(parsed);
    } catch {
      // invalid JSON inside fence
    }
  }

  // Fallback: treat raw text as the root cause with low confidence
  const fallbackCause = raw.trim().slice(0, 2000);
  return {
    root_cause: fallbackCause,
    contributing_factors: [],
    severity_assessment: 'unknown',
    recommended_actions: [],
    confidence_score: 0.3,
    ai_summary: fallbackCause.slice(0, 200),
  };
}

function validateParsedResult(parsed: Record<string, unknown>): ParsedInvestigationResult {
  const rootCause = typeof parsed.root_cause === 'string' ? parsed.root_cause : 'Unable to determine root cause';

  const contributingFactors = Array.isArray(parsed.contributing_factors)
    ? parsed.contributing_factors.filter((f): f is string => typeof f === 'string')
    : [];

  const severityAssessment = typeof parsed.severity_assessment === 'string'
    ? parsed.severity_assessment
    : 'unknown';

  const recommendedActions = Array.isArray(parsed.recommended_actions)
    ? parsed.recommended_actions
        .map((a: unknown) => {
          if (typeof a === 'object' && a !== null) {
            const obj = a as Record<string, unknown>;
            return {
              action: typeof obj.action === 'string' ? obj.action : String(obj.action ?? ''),
              priority: (['high', 'medium', 'low'] as const).includes(obj.priority as 'high' | 'medium' | 'low')
                ? (obj.priority as 'high' | 'medium' | 'low')
                : 'medium' as const,
              rationale: typeof obj.rationale === 'string' ? obj.rationale : undefined,
            };
          }
          if (typeof a === 'string') {
            return { action: a, priority: 'medium' as const };
          }
          return null;
        })
        .filter((a): a is RecommendedAction => a !== null)
    : [];

  const confidenceScore = typeof parsed.confidence_score === 'number'
    ? Math.max(0, Math.min(1, parsed.confidence_score))
    : 0.5;

  const aiSummary = typeof parsed.ai_summary === 'string'
    ? parsed.ai_summary.slice(0, 200)
    : rootCause.slice(0, 200);

  return {
    root_cause: rootCause,
    contributing_factors: contributingFactors,
    severity_assessment: severityAssessment,
    recommended_actions: recommendedActions,
    confidence_score: confidenceScore,
    ai_summary: aiSummary,
  };
}

export function buildInvestigationPrompt(
  insight: Insight,
  evidence: {
    logs?: string;
    metrics?: MetricSnapshot[];
    relatedContainers?: string[];
    forecasts?: CapacityForecast[];
  },
): string {
  const parts: string[] = [
    '# Root Cause Investigation',
    '',
    '## Anomaly Details',
    `- **Title**: ${insight.title}`,
    `- **Description**: ${insight.description}`,
    `- **Severity**: ${insight.severity}`,
    `- **Container**: ${insight.container_name || 'N/A'} (${insight.container_id?.slice(0, 12) || 'N/A'})`,
    `- **Endpoint**: ${insight.endpoint_name || 'N/A'}`,
    `- **Time**: ${insight.created_at}`,
  ];

  if (evidence.logs) {
    parts.push('', '## Recent Container Logs', '```', evidence.logs, '```');
  }

  if (evidence.metrics && evidence.metrics.length > 0) {
    parts.push('', '## Metrics Summary');
    for (const m of evidence.metrics) {
      parts.push(
        `- **${m.metric_type}**: current=${m.current.toFixed(1)}%, mean=${m.mean.toFixed(1)}%, std_dev=${m.std_dev.toFixed(2)}, samples=${m.sample_count}`,
      );
    }
  }

  if (evidence.relatedContainers && evidence.relatedContainers.length > 0) {
    parts.push('', '## Related Containers on Same Endpoint');
    for (const name of evidence.relatedContainers) {
      parts.push(`- ${name}`);
    }
  }

  if (evidence.forecasts && evidence.forecasts.length > 0) {
    parts.push('', '## Capacity Forecast');
    for (const f of evidence.forecasts) {
      const ttt = f.timeToThreshold != null ? `${f.timeToThreshold}h` : 'N/A';
      parts.push(
        `- **${f.metricType}**: trend=${f.trend}, slope=${f.slope.toFixed(3)}/h, ` +
        `R²=${f.r_squared.toFixed(2)}, current=${f.currentValue.toFixed(1)}%, ` +
        `time-to-threshold=${ttt}, confidence=${f.confidence}`,
      );
    }
  }

  parts.push(
    '',
    '## Instructions',
    'Analyze the above evidence and provide a root cause analysis. Respond with ONLY a JSON object (no markdown fencing, no extra text) with this exact structure:',
    '',
    '```json',
    '{',
    '  "root_cause": "Clear explanation of the most likely root cause",',
    '  "contributing_factors": ["Factor 1", "Factor 2"],',
    '  "severity_assessment": "critical | warning | info",',
    '  "recommended_actions": [',
    '    { "action": "What to do", "priority": "high | medium | low", "rationale": "Why" }',
    '  ],',
    '  "confidence_score": 0.85,',
    '  "ai_summary": "One-sentence executive summary of the root cause and impact"',
    '}',
    '```',
    '',
    'Important:',
    '- confidence_score: 0.0 to 1.0 based on evidence quality',
    '- Be specific about container behavior, not generic',
    '- recommended_actions should be read-only observations/suggestions, never destructive commands',
  );

  return parts.join('\n');
}

async function gatherEvidence(insight: Insight): Promise<{
  logs?: string;
  metrics?: MetricSnapshot[];
  relatedContainers?: string[];
  forecasts?: CapacityForecast[];
  evidenceSummary: EvidenceSummary;
}> {
  const config = getConfig();
  const evidence: {
    logs?: string;
    metrics?: MetricSnapshot[];
    relatedContainers?: string[];
    forecasts?: CapacityForecast[];
    evidenceSummary: EvidenceSummary;
  } = { evidenceSummary: {} };

  const promises: Promise<void>[] = [];

  // Gather logs
  if (insight.endpoint_id && insight.container_id) {
    promises.push(
      (async () => {
        try {
          const rawLogs = await getContainerLogs(
            insight.endpoint_id!,
            insight.container_id!,
            { tail: config.INVESTIGATION_LOG_TAIL_LINES, timestamps: true },
          );
          // Cap at 5KB
          evidence.logs = rawLogs.slice(0, 5120);
          evidence.evidenceSummary.log_lines_collected = evidence.logs.split('\n').length;
          evidence.evidenceSummary.log_excerpt = evidence.logs.slice(0, 500);
        } catch (err) {
          log.warn({ err, containerId: insight.container_id }, 'Failed to gather container logs');
        }
      })(),
    );
  }

  // Gather metrics
  if (insight.container_id) {
    promises.push(
      (async () => {
        try {
          const metricsWindow = config.INVESTIGATION_METRICS_WINDOW_MINUTES;
          const now = new Date();
          const from = new Date(now.getTime() - metricsWindow * 60 * 1000);
          const snapshots: MetricSnapshot[] = [];

          for (const metricType of ['cpu', 'memory']) {
            const avg = await getMovingAverage(insight.container_id!, metricType, 30);
            if (avg) {
              const recent = await getMetrics(
                insight.container_id!,
                metricType,
                from.toISOString(),
                now.toISOString(),
              );
              const currentValue = recent.length > 0 ? recent[recent.length - 1].value : 0;
              snapshots.push({
                metric_type: metricType,
                current: currentValue,
                mean: avg.mean,
                std_dev: avg.std_dev,
                sample_count: avg.sample_count,
              });
            }
          }

          evidence.metrics = snapshots;
          evidence.evidenceSummary.metrics = snapshots;
        } catch (err) {
          log.warn({ err, containerId: insight.container_id }, 'Failed to gather metrics');
        }
      })(),
    );
  }

  // Gather related containers
  if (insight.endpoint_id) {
    promises.push(
      (async () => {
        try {
          const containers = await getContainers(insight.endpoint_id!);
          const related = containers
            .filter((c) => c.Id !== insight.container_id)
            .slice(0, 10)
            .map((c) => {
              const name = c.Names?.[0]?.replace(/^\//, '') || c.Id.slice(0, 12);
              return `${name} (${c.State})`;
            });
          evidence.relatedContainers = related;
          evidence.evidenceSummary.related_containers = related;
        } catch (err) {
          log.warn({ err, endpointId: insight.endpoint_id }, 'Failed to gather related containers');
        }
      })(),
    );
  }

  // Gather capacity forecasts
  if (insight.container_id && insight.container_name) {
    try {
      const forecasts: CapacityForecast[] = [];
      for (const metricType of ['cpu', 'memory']) {
        const forecast = await generateForecast(insight.container_id, insight.container_name, metricType);
        if (forecast) forecasts.push(forecast);
      }
      if (forecasts.length > 0) {
        evidence.forecasts = forecasts;
      }
    } catch (err) {
      log.warn({ err, containerId: insight.container_id }, 'Failed to gather capacity forecasts');
    }
  }

  await Promise.all(promises);
  return evidence;
}

async function runInvestigation(investigationId: string, insight: Insight): Promise<void> {
  const config = getConfig();
  const startTime = Date.now();

  try {
    // Phase 1: Gather evidence
    updateInvestigationStatus(investigationId, 'gathering');
    broadcastInvestigationUpdate(investigationId, 'gathering');

    const evidence = await gatherEvidence(insight);

    // Phase 2: LLM analysis
    updateInvestigationStatus(investigationId, 'analyzing', {
      evidence_summary: JSON.stringify(evidence.evidenceSummary),
    });
    broadcastInvestigationUpdate(investigationId, 'analyzing');

    const prompt = buildInvestigationPrompt(insight, evidence);

    let llmResponse = '';
    await chatStream(
      [{ role: 'user', content: prompt }],
      getEffectivePrompt('root_cause'),
      (chunk) => { llmResponse += chunk; },
    );

    // Phase 3: Parse and store
    const result = parseInvestigationResponse(llmResponse);
    const durationMs = Date.now() - startTime;

    updateInvestigationStatus(investigationId, 'complete', {
      root_cause: result.root_cause,
      contributing_factors: JSON.stringify(result.contributing_factors),
      severity_assessment: result.severity_assessment,
      recommended_actions: JSON.stringify(result.recommended_actions),
      confidence_score: result.confidence_score,
      ai_summary: result.ai_summary,
      analysis_duration_ms: durationMs,
      llm_model: config.OLLAMA_MODEL,
      completed_at: new Date().toISOString(),
    });

    broadcastInvestigationComplete(investigationId);

    log.info(
      { investigationId, durationMs, confidence: result.confidence_score },
      'Investigation completed',
    );
  } catch (err) {
    const durationMs = Date.now() - startTime;
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';

    updateInvestigationStatus(investigationId, 'failed', {
      error_message: errorMessage,
      analysis_duration_ms: durationMs,
      completed_at: new Date().toISOString(),
    });

    broadcastInvestigationUpdate(investigationId, 'failed');
    log.error({ investigationId, err }, 'Investigation failed');
  } finally {
    activeInvestigations = Math.max(0, activeInvestigations - 1);
  }
}

function broadcastInvestigationUpdate(investigationId: string, status: string): void {
  if (!investigationNamespace) return;
  investigationNamespace.to('severity:all').emit('investigation:update', { id: investigationId, status });
}

function broadcastInvestigationComplete(investigationId: string): void {
  if (!investigationNamespace) return;

  const investigation = getInvestigation(investigationId);
  if (investigation) {
    investigationNamespace.to('severity:all').emit('investigation:complete', investigation);
  }
}

export async function triggerInvestigation(insight: Insight): Promise<void> {
  const config = getConfig();

  // Guard: feature flag
  if (!config.INVESTIGATION_ENABLED) {
    log.debug('Investigation disabled by configuration');
    return;
  }

  // Guard: must have container context
  if (!insight.container_id || !insight.endpoint_id) {
    log.debug({ insightId: insight.id }, 'Skipping investigation: no container context');
    return;
  }

  // Guard: concurrency limit
  if (activeInvestigations >= config.INVESTIGATION_MAX_CONCURRENT) {
    log.debug(
      { activeInvestigations, max: config.INVESTIGATION_MAX_CONCURRENT },
      'Skipping investigation: concurrency limit reached',
    );
    return;
  }

  // Guard: in-memory cooldown
  const lastRun = cooldownMap.get(insight.container_id);
  const cooldownMs = config.INVESTIGATION_COOLDOWN_MINUTES * 60 * 1000;
  if (lastRun && Date.now() - lastRun < cooldownMs) {
    log.debug(
      { containerId: insight.container_id },
      'Skipping investigation: in-memory cooldown active',
    );
    return;
  }

  // Guard: DB cooldown (for durability across restarts)
  const recent = getRecentInvestigationForContainer(
    insight.container_id,
    config.INVESTIGATION_COOLDOWN_MINUTES,
  );
  if (recent) {
    log.debug(
      { containerId: insight.container_id, recentId: recent.id },
      'Skipping investigation: recent investigation exists',
    );
    return;
  }

  // Guard: LLM availability
  const llmAvailable = await isOllamaAvailable();
  if (!llmAvailable) {
    log.debug('Skipping investigation: LLM not available');
    return;
  }

  // All guards passed — create and run
  const investigationId = uuidv4();

  insertInvestigation({
    id: investigationId,
    insight_id: insight.id,
    endpoint_id: insight.endpoint_id,
    container_id: insight.container_id,
    container_name: insight.container_name,
  });

  activeInvestigations++;
  cooldownMap.set(insight.container_id, Date.now());

  log.info(
    { investigationId, insightId: insight.id, containerId: insight.container_id },
    'Triggering root cause investigation',
  );

  // Fire-and-forget
  runInvestigation(investigationId, insight).catch((err) => {
    log.error({ investigationId, err }, 'Unhandled error in investigation');
  });
}
