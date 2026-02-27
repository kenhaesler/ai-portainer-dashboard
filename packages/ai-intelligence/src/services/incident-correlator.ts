import { v4 as uuidv4 } from 'uuid';
import { createChildLogger } from '@dashboard/core/utils/logger.js';
import { getConfig } from '@dashboard/core/config/index.js';
import { isOllamaAvailable } from './llm-client.js';
import type { Insight } from '@dashboard/core/models/monitoring.js';
import {
  insertIncident,
  addInsightToIncident,
  getActiveIncidentForContainer,
  type IncidentInsert,
} from './incident-store.js';
import { generateLlmIncidentSummary } from './incident-summarizer.js';

const log = createChildLogger('incident-correlator');

// Default correlation window in minutes
const DEFAULT_CORRELATION_WINDOW = 5;

export interface CorrelationResult {
  incidentsCreated: number;
  insightsGrouped: number;
  insightsUngrouped: number;
}

type FindSimilarInsightsFn = (
  insights: Insight[],
  threshold: number,
) => Array<{ insights: Insight[] }>;

/**
 * Correlate a batch of new insights into incidents.
 * Called after each monitoring cycle with the batch of freshly created insights.
 *
 * Correlation rules (applied in order):
 * 1. Dedup: Same container + same metric type within window → merge into existing incident
 * 2. Cascade: Multiple containers on same endpoint within window → group as cascade
 * 3. Temporal: Any insights within the window on the same endpoint → group
 *
 * @param findSimilarInsights - injected dependency to avoid @dashboard/observability import
 */
export async function correlateInsights(
  insights: Insight[],
  correlationWindowMinutes: number = DEFAULT_CORRELATION_WINDOW,
  findSimilarInsights?: FindSimilarInsightsFn,
): Promise<CorrelationResult> {
  const result: CorrelationResult = {
    incidentsCreated: 0,
    insightsGrouped: 0,
    insightsUngrouped: 0,
  };

  if (insights.length === 0) return result;

  // Separate anomaly insights (primary correlation targets) from others
  const anomalyInsights = insights.filter((i) => i.category === 'anomaly');
  const otherInsights = insights.filter((i) => i.category !== 'anomaly');

  // Only correlate anomaly insights — security/AI insights are standalone
  if (anomalyInsights.length === 0) {
    result.insightsUngrouped = insights.length;
    return result;
  }

  // Single anomaly — no grouping needed
  if (anomalyInsights.length === 1) {
    const insight = anomalyInsights[0];
    // Check if it fits into an existing active incident
    if (insight.container_id) {
      const existing = await getActiveIncidentForContainer(insight.container_id, correlationWindowMinutes);
      if (existing) {
        await addInsightToIncident(existing.id, insight.id, insight.container_name ?? undefined);
        result.insightsGrouped = 1;
        log.debug({ incidentId: existing.id, insightId: insight.id }, 'Added insight to existing incident');
        return result;
      }
    }
    result.insightsUngrouped = 1 + otherInsights.length;
    return result;
  }

  // Multiple anomalies in this batch — attempt correlation
  const grouped = groupByCorrelation(anomalyInsights, correlationWindowMinutes);

  // Semantic grouping pass: group ungrouped singles by text similarity
  const config = getConfig();
  if (config.SMART_GROUPING_ENABLED && findSimilarInsights) {
    const ungroupedSingles = grouped.filter((g) => g.insights.length === 1);
    if (ungroupedSingles.length >= 2) {
      const ungroupedInsights = ungroupedSingles.map((g) => g.insights[0]);
      const semanticGroups = findSimilarInsights(ungroupedInsights, config.SMART_GROUPING_SIMILARITY_THRESHOLD);

      for (const semanticGroup of semanticGroups) {
        // Remove the individual entries from grouped
        for (const insight of semanticGroup.insights) {
          const idx = grouped.findIndex(
            (g) => g.insights.length === 1 && g.insights[0].id === insight.id,
          );
          if (idx >= 0) grouped.splice(idx, 1);
        }

        // Sort by severity, then earliest
        const sorted = [...semanticGroup.insights].sort((a, b) => {
          const sevOrder = { critical: 0, warning: 1, info: 2 };
          const sevDiff = sevOrder[a.severity] - sevOrder[b.severity];
          if (sevDiff !== 0) return sevDiff;
          return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
        });

        grouped.push({
          insights: semanticGroup.insights,
          correlationType: 'semantic',
          rootCause: sorted[0],
        });
      }
    }
  }

  // LLM summary enrichment for multi-insight groups
  const ollamaAvailable = config.INCIDENT_SUMMARY_ENABLED ? await isOllamaAvailable() : false;
  if (ollamaAvailable) {
    for (const group of grouped) {
      if (group.insights.length >= 2) {
        try {
          const llmSummary = await generateLlmIncidentSummary(group.insights, group.correlationType);
          if (llmSummary) {
            group.llmSummary = llmSummary;
          }
        } catch (err) {
          log.debug({ err }, 'LLM incident summary failed, using rule-based summary');
        }
      }
    }
  }

  for (const group of grouped) {
    if (group.insights.length < 2) {
      // Single insight — check for existing incident to join
      const insight = group.insights[0];
      if (insight.container_id) {
        const existing = await getActiveIncidentForContainer(insight.container_id, correlationWindowMinutes);
        if (existing) {
          await addInsightToIncident(existing.id, insight.id, insight.container_name ?? undefined);
          result.insightsGrouped++;
          continue;
        }
      }
      result.insightsUngrouped++;
      continue;
    }

    // Create a new incident for this group
    const incident = buildIncident(group);
    try {
      await insertIncident(incident);
      result.incidentsCreated++;
      result.insightsGrouped += group.insights.length;
      log.info(
        { incidentId: incident.id, insightCount: group.insights.length, type: group.correlationType },
        'New incident created from correlated insights',
      );
    } catch (err) {
      log.error({ err, groupSize: group.insights.length }, 'Failed to create incident');
      result.insightsUngrouped += group.insights.length;
    }
  }

  result.insightsUngrouped += otherInsights.length;
  return result;
}

interface InsightGroup {
  insights: Insight[];
  correlationType: 'cascade' | 'dedup' | 'temporal' | 'semantic';
  rootCause: Insight;
  llmSummary?: string;
}

function groupByCorrelation(
  insights: Insight[],
  _windowMinutes: number,
): InsightGroup[] {
  // Group by endpoint first
  const byEndpoint = new Map<number | null, Insight[]>();
  for (const insight of insights) {
    const key = insight.endpoint_id;
    if (!byEndpoint.has(key)) byEndpoint.set(key, []);
    byEndpoint.get(key)!.push(insight);
  }

  const groups: InsightGroup[] = [];

  for (const [, endpointInsights] of byEndpoint) {
    if (endpointInsights.length < 2) {
      // Not enough to correlate on this endpoint — pass through individually
      groups.push({
        insights: endpointInsights,
        correlationType: 'temporal',
        rootCause: endpointInsights[0],
      });
      continue;
    }

    // Check for dedup: same container + same metric category
    const dedupGroups = groupByContainerAndMetric(endpointInsights);

    for (const dedupGroup of dedupGroups) {
      if (dedupGroup.length >= 2) {
        // Multiple anomalies for the same container — dedup
        // Root cause is the earliest (already sorted by creation time)
        groups.push({
          insights: dedupGroup,
          correlationType: 'dedup',
          rootCause: dedupGroup[0],
        });
      } else {
        // Collect singles for cascade detection
        groups.push({
          insights: dedupGroup,
          correlationType: 'temporal',
          rootCause: dedupGroup[0],
        });
      }
    }

    // After dedup, check if remaining singles form a cascade on same endpoint
    const singles = groups.filter(
      (g) => g.insights.length === 1 && g.insights[0].endpoint_id === endpointInsights[0].endpoint_id,
    );

    if (singles.length >= 2) {
      const cascadeInsights = singles.flatMap((s) => s.insights);

      // Require at least 2 distinct anomaly types (e.g., cpu + memory)
      // to avoid cascade alerts from the same metric spiking on multiple containers
      const distinctTypes = new Set(
        cascadeInsights.map((i) => extractMetricType(i.title)),
      );

      if (distinctTypes.size >= 2) {
        // Remove the singles from groups
        for (const single of singles) {
          const idx = groups.indexOf(single);
          if (idx >= 0) groups.splice(idx, 1);
        }

        // Root cause: the insight with the highest severity, or earliest
        const sorted = [...cascadeInsights].sort((a, b) => {
          const sevOrder = { critical: 0, warning: 1, info: 2 };
          const sevDiff = sevOrder[a.severity] - sevOrder[b.severity];
          if (sevDiff !== 0) return sevDiff;
          return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
        });

        groups.push({
          insights: cascadeInsights,
          correlationType: 'cascade',
          rootCause: sorted[0],
        });
      }
      // else: leave as individual singles (no cascade for same-type anomalies)
    }
  }

  return groups;
}

/**
 * Extract the metric type from an anomaly insight title.
 * Titles follow the pattern: 'Anomalous cpu usage on "container"'
 * Falls back to the full title if pattern doesn't match.
 */
function extractMetricType(title: string): string {
  const match = /anomalous\s+(\w+)\s+usage/i.exec(title);
  return match ? match[1].toLowerCase() : title;
}

function groupByContainerAndMetric(insights: Insight[]): Insight[][] {
  const groups = new Map<string, Insight[]>();
  for (const insight of insights) {
    // Key by container_id — anomalies for the same container get deduped
    const key = insight.container_id || insight.id;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(insight);
  }
  return Array.from(groups.values());
}

function buildIncident(group: InsightGroup): IncidentInsert {
  const { insights, correlationType, rootCause } = group;

  // Highest severity across all insights in the group
  const severity = getHighestSeverity(insights);

  // Collect affected container names
  const containers = [...new Set(
    insights.map((i) => i.container_name).filter(Boolean) as string[],
  )];

  // Related insight IDs (excluding root cause)
  const relatedIds = insights
    .filter((i) => i.id !== rootCause.id)
    .map((i) => i.id);

  // Generate title
  const title = generateIncidentTitle(group);

  // Generate summary — prefer LLM summary if available
  const summary = group.llmSummary ?? generateIncidentSummary(group);

  // Confidence: cascade with 3+ insights = high, 2 = medium, dedup = high, semantic = medium
  let confidence: 'high' | 'medium' | 'low' = 'medium';
  if (correlationType === 'dedup') confidence = 'high';
  if (correlationType === 'cascade' && insights.length >= 3) confidence = 'high';

  return {
    id: uuidv4(),
    title,
    severity,
    root_cause_insight_id: rootCause.id,
    related_insight_ids: relatedIds,
    affected_containers: containers,
    endpoint_id: rootCause.endpoint_id,
    endpoint_name: rootCause.endpoint_name,
    correlation_type: correlationType,
    correlation_confidence: confidence,
    insight_count: insights.length,
    summary,
  };
}

function getHighestSeverity(insights: Insight[]): 'critical' | 'warning' | 'info' {
  if (insights.some((i) => i.severity === 'critical')) return 'critical';
  if (insights.some((i) => i.severity === 'warning')) return 'warning';
  return 'info';
}

function generateIncidentTitle(group: InsightGroup): string {
  const { insights, correlationType } = group;
  const containers = [...new Set(
    insights.map((i) => i.container_name).filter(Boolean),
  )];
  const endpointName = insights[0].endpoint_name;

  if (correlationType === 'dedup' && containers.length === 1) {
    return `Multiple anomalies on "${containers[0]}"`;
  }

  if (correlationType === 'cascade') {
    if (containers.length <= 3) {
      return `Cascade anomaly affecting ${containers.join(', ')}`;
    }
    return `Cascade anomaly affecting ${containers.length} containers${endpointName ? ` on ${endpointName}` : ''}`;
  }

  if (correlationType === 'semantic') {
    if (containers.length <= 3) {
      return `Similar anomalies on ${containers.join(', ')}`;
    }
    return `Similar anomalies across ${containers.length} containers`;
  }

  return `Correlated anomalies on ${endpointName || 'unknown endpoint'} (${insights.length} alerts)`;
}

function generateIncidentSummary(group: InsightGroup): string {
  const { insights, correlationType, rootCause } = group;

  const parts: string[] = [];

  if (correlationType === 'cascade') {
    parts.push(`Cascade detected: ${insights.length} containers showing anomalous behavior simultaneously.`);
    parts.push(`Likely root cause: ${rootCause.title}`);
  } else if (correlationType === 'dedup') {
    parts.push(`${insights.length} duplicate anomalies detected for the same container within the correlation window.`);
  } else if (correlationType === 'semantic') {
    parts.push(`${insights.length} semantically similar anomalies grouped by text similarity analysis.`);
    parts.push(`Primary alert: ${rootCause.title}`);
  } else {
    parts.push(`${insights.length} related anomalies detected within the correlation window.`);
  }

  const critCount = insights.filter((i) => i.severity === 'critical').length;
  const warnCount = insights.filter((i) => i.severity === 'warning').length;
  if (critCount > 0 || warnCount > 0) {
    parts.push(`Severity breakdown: ${critCount} critical, ${warnCount} warning.`);
  }

  return parts.join(' ');
}
