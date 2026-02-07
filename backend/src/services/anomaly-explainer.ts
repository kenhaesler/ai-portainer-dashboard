import { createChildLogger } from '../utils/logger.js';
import { chatStream } from './llm-client.js';
import type { InsightInsert } from './insights-store.js';

const log = createChildLogger('anomaly-explainer');

const SYSTEM_PROMPT =
  'You are a Docker infrastructure analyst. Be specific, concise, and actionable. No markdown.';

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
      SYSTEM_PROMPT,
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
 * Batch-explain anomalies, prioritizing critical over warning.
 * Sequential calls to avoid overwhelming Ollama.
 * Returns Map of insightId → explanation.
 */
export async function explainAnomalies(
  anomalies: Array<{ insight: InsightInsert; description: string }>,
  maxExplanations: number,
): Promise<Map<string, string>> {
  const explanations = new Map<string, string>();

  // Sort: critical first, then warning
  const sorted = [...anomalies].sort((a, b) => {
    const severityOrder = { critical: 0, warning: 1, info: 2 };
    const aOrder = severityOrder[a.insight.severity as keyof typeof severityOrder] ?? 2;
    const bOrder = severityOrder[b.insight.severity as keyof typeof severityOrder] ?? 2;
    return aOrder - bOrder;
  });

  const toExplain = sorted.slice(0, maxExplanations);

  for (const { insight, description } of toExplain) {
    const explanation = await explainAnomaly(insight, description);
    if (explanation) {
      explanations.set(insight.id, explanation);
    }
  }

  return explanations;
}
