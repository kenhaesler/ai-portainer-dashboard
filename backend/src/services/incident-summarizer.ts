import { createChildLogger } from '../utils/logger.js';
import { chatStream } from './llm-client.js';
import { getEffectivePrompt } from './prompt-store.js';
import type { Insight } from '../models/monitoring.js';

const log = createChildLogger('incident-summarizer');

/**
 * Generate an LLM-powered incident summary for a group of correlated insights.
 * Returns null if LLM fails or fewer than 2 insights.
 */
export async function generateLlmIncidentSummary(
  insights: Insight[],
  correlationType: string,
): Promise<string | null> {
  if (insights.length < 2) return null;

  try {
    const alertDescriptions = insights
      .map((ins, i) => `${i + 1}. [${ins.severity}] ${ins.title}: ${ins.description.slice(0, 200)}`)
      .join('\n');

    const userPrompt =
      `Correlation type: ${correlationType}\n` +
      `Number of alerts: ${insights.length}\n\n` +
      `Alerts:\n${alertDescriptions}`;

    let response = '';
    await chatStream(
      [{ role: 'user', content: userPrompt }],
      getEffectivePrompt('incident_summarizer'),
      (chunk) => { response += chunk; },
    );

    const trimmed = response.trim();
    if (!trimmed) return null;

    // Cap at 500 chars
    return trimmed.slice(0, 500);
  } catch (err) {
    log.warn({ err, insightCount: insights.length, correlationType }, 'Failed to generate incident summary');
    return null;
  }
}
