import { createChildLogger } from '../utils/logger.js';
import { chatStream } from './llm-client.js';
import { getEffectivePrompt } from './prompt-store.js';
import type { InsightInsert } from './insights-store.js';

const log = createChildLogger('anomaly-explainer');

/**
 * Use LLM to explain a single anomaly in 2-3 plain-English sentences.
 * Returns the explanation string, or null on failure.
 */
export async function explainAnomaly(
  insight: InsightInsert,
  anomalyDescription: string,
): Promise<string | null> {
  try {
    const userPrompt =
      `Explain this container anomaly in 2-3 sentences for an ops engineer. ` +
      `What does it mean and what might cause it?\n\n` +
      `Container: ${insight.container_name ?? 'unknown'}\n` +
      `Title: ${insight.title}\n` +
      `Details: ${anomalyDescription}`;

    let response = '';
    await chatStream(
      [{ role: 'user', content: userPrompt }],
      getEffectivePrompt('anomaly_explainer'),
      (chunk) => { response += chunk; },
    );

    const trimmed = response.trim();
    if (!trimmed) return null;

    // Cap at 500 chars to keep descriptions readable
    return trimmed.slice(0, 500);
  } catch (err) {
    log.warn({ err, insightId: insight.id }, 'Failed to explain anomaly');
    return null;
  }
}

/**
 * Parse the batch LLM response into individual explanations.
 * Expects format: [1] explanation text\n[2] explanation text\n...
 */
function parseBatchResponse(response: string, count: number): string[] {
  const results: string[] = new Array(count).fill('');

  for (let i = 0; i < count; i++) {
    const tag = `[${i + 1}]`;
    const nextTag = `[${i + 2}]`;
    const startIdx = response.indexOf(tag);
    if (startIdx === -1) continue;

    const contentStart = startIdx + tag.length;
    const endIdx = i < count - 1 ? response.indexOf(nextTag, contentStart) : response.length;
    const text = response
      .slice(contentStart, endIdx === -1 ? undefined : endIdx)
      .trim();

    if (text) {
      results[i] = text.slice(0, 500); // Cap each explanation at 500 chars
    }
  }

  return results;
}

/**
 * Batch-explain anomalies in a single LLM call.
 * Sends all anomalies in one prompt and parses numbered responses.
 * Falls back to individual calls if batch parsing fails.
 * Returns Map of insightId → explanation.
 */
export async function explainAnomalies(
  anomalies: Array<{ insight: InsightInsert; description: string }>,
  maxExplanations: number,
): Promise<Map<string, string>> {
  const explanations = new Map<string, string>();
  if (anomalies.length === 0) return explanations;

  // Sort: critical first, then warning
  const sorted = [...anomalies].sort((a, b) => {
    const severityOrder = { critical: 0, warning: 1, info: 2 };
    const aOrder = severityOrder[a.insight.severity as keyof typeof severityOrder] ?? 2;
    const bOrder = severityOrder[b.insight.severity as keyof typeof severityOrder] ?? 2;
    return aOrder - bOrder;
  });

  const toExplain = sorted.slice(0, maxExplanations);

  // Single anomaly — use simple prompt
  if (toExplain.length === 1) {
    const { insight, description } = toExplain[0];
    const explanation = await explainAnomaly(insight, description);
    if (explanation) {
      explanations.set(insight.id, explanation);
    }
    return explanations;
  }

  // Multiple anomalies — batch into one LLM call
  try {
    const anomalyList = toExplain
      .map((a, i) =>
        `[${i + 1}] Container: ${a.insight.container_name ?? 'unknown'} | ` +
        `${a.insight.title} | ${a.description}`,
      )
      .join('\n');

    const userPrompt =
      `Explain each container anomaly below in 2-3 sentences for an ops engineer. ` +
      `What does it mean and what might cause it? ` +
      `Reply with the same numbered format [1], [2], etc.\n\n${anomalyList}`;

    let response = '';
    await chatStream(
      [{ role: 'user', content: userPrompt }],
      getEffectivePrompt('anomaly_explainer'),
      (chunk) => { response += chunk; },
    );

    const parsed = parseBatchResponse(response.trim(), toExplain.length);
    let batchHits = 0;

    for (let i = 0; i < toExplain.length; i++) {
      if (parsed[i]) {
        explanations.set(toExplain[i].insight.id, parsed[i]);
        batchHits++;
      }
    }

    log.info(
      { batch: toExplain.length, explained: batchHits },
      'Batch anomaly explanation completed',
    );

    // Fall back to individual calls for any that failed to parse
    if (batchHits < toExplain.length) {
      for (let i = 0; i < toExplain.length; i++) {
        if (!parsed[i]) {
          const { insight, description } = toExplain[i];
          const explanation = await explainAnomaly(insight, description);
          if (explanation) {
            explanations.set(insight.id, explanation);
          }
        }
      }
    }
  } catch (err) {
    log.warn({ err }, 'Batch anomaly explanation failed, falling back to individual calls');

    // Full fallback: explain individually
    for (const { insight, description } of toExplain) {
      const explanation = await explainAnomaly(insight, description);
      if (explanation) {
        explanations.set(insight.id, explanation);
      }
    }
  }

  return explanations;
}
