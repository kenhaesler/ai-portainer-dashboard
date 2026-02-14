import pLimit from 'p-limit';
import { createChildLogger } from '../utils/logger.js';
import { getConfig } from '../config/index.js';
import { chatStream } from './llm-client.js';
import { getEffectivePrompt } from './prompt-store.js';
import { getContainerLogs } from './portainer-client.js';
import { cachedFetch, getCacheKey } from './portainer-cache.js';

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
    const logs = await cachedFetch(
      getCacheKey('analyzer-logs', endpointId, containerId),
      60, // 60s TTL — log analysis runs once per monitoring cycle (5 min)
      () => getContainerLogs(endpointId, containerId, { tail: tailLines }),
    );

    if (!logs || logs.trim().length < 20) {
      return null;
    }

    let response = '';
    await chatStream(
      [{ role: 'user', content: `Analyze these container logs from "${containerName}":\n\n${logs.slice(0, 4000)}` }],
      await getEffectivePrompt('log_analyzer'),
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
  priorityContainerIds?: string[],
): Promise<LogAnalysisResult[]> {
  // Prioritize containers with recent anomalies/restarts if a priority list is provided
  let ordered = [...containers];
  if (priorityContainerIds && priorityContainerIds.length > 0) {
    const prioritySet = new Set(priorityContainerIds);
    ordered.sort((a, b) => {
      const aP = prioritySet.has(a.containerId) ? 0 : 1;
      const bP = prioritySet.has(b.containerId) ? 0 : 1;
      return aP - bP;
    });
  }

  const toAnalyze = ordered.slice(0, maxContainers);
  const config = getConfig();
  const limit = pLimit(config.LOG_ANALYSIS_CONCURRENCY);

  const settled = await Promise.allSettled(
    toAnalyze.map((container) =>
      limit(() =>
        analyzeContainerLogs(
          container.endpointId,
          container.containerId,
          container.containerName,
          tailLines,
        ),
      ),
    ),
  );

  const results: LogAnalysisResult[] = [];
  for (const result of settled) {
    if (result.status === 'fulfilled' && result.value) {
      results.push(result.value);
    } else if (result.status === 'rejected') {
      log.warn({ err: result.reason }, 'Log analysis failed for container');
    }
  }

  return results;
}
