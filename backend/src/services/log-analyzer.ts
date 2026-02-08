import { createChildLogger } from '../utils/logger.js';
import { chatStream } from './llm-client.js';
import { getEffectivePrompt } from './prompt-store.js';
import { getContainerLogs } from './portainer-client.js';

const log = createChildLogger('log-analyzer');

export interface LogAnalysisResult {
  containerId: string;
  containerName: string;
  severity: 'critical' | 'warning' | 'info';
  summary: string;
  errorPatterns: string[];
}

export async function analyzeContainerLogs(
  endpointId: number,
  containerId: string,
  containerName: string,
  tailLines: number,
): Promise<LogAnalysisResult | null> {
  try {
    const logs = await getContainerLogs(endpointId, containerId, { tail: tailLines });

    if (!logs || logs.trim().length < 20) {
      return null;
    }

    let response = '';
    await chatStream(
      [{ role: 'user', content: `Analyze these container logs from "${containerName}":\n\n${logs.slice(0, 4000)}` }],
      getEffectivePrompt('log_analyzer'),
      (chunk) => { response += chunk; },
    );

    const trimmed = response.trim();
    if (!trimmed || trimmed === 'null') return null;

    // Extract JSON from response (may have extra text around it)
    const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]) as {
      severity?: string;
      summary?: string;
      errorPatterns?: string[];
    };

    if (!parsed.severity || !parsed.summary) return null;

    const severity = ['critical', 'warning', 'info'].includes(parsed.severity)
      ? (parsed.severity as 'critical' | 'warning' | 'info')
      : 'info';

    return {
      containerId,
      containerName,
      severity,
      summary: parsed.summary.slice(0, 500),
      errorPatterns: Array.isArray(parsed.errorPatterns)
        ? parsed.errorPatterns.map(String).slice(0, 10)
        : [],
    };
  } catch (err) {
    log.warn({ err, containerId, containerName }, 'Failed to analyze container logs');
    return null;
  }
}

export async function analyzeLogsForContainers(
  containers: Array<{ endpointId: number; containerId: string; containerName: string }>,
  maxContainers: number,
  tailLines: number,
): Promise<LogAnalysisResult[]> {
  const toAnalyze = containers.slice(0, maxContainers);
  const results: LogAnalysisResult[] = [];

  // Sequential calls to avoid overwhelming Ollama
  for (const container of toAnalyze) {
    const result = await analyzeContainerLogs(
      container.endpointId,
      container.containerId,
      container.containerName,
      tailLines,
    );
    if (result) {
      results.push(result);
    }
  }

  return results;
}
