import { getConfig } from '../config/index.js';
import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('kibana-client');

export interface LogEntry {
  timestamp: string;
  message: string;
  level: string;
  hostname?: string;
  source?: string;
  [key: string]: unknown;
}

export interface FetchLogsOptions {
  query: string;
  hostname?: string;
  from?: string;
  to?: string;
  limit?: number;
}

export async function fetchLogs(options: FetchLogsOptions): Promise<LogEntry[]> {
  const config = getConfig();

  if (!config.KIBANA_ENDPOINT) {
    log.debug('Kibana endpoint not configured, returning empty results');
    return [];
  }

  const searchBody: Record<string, unknown> = {
    size: options.limit ?? 100,
    sort: [{ '@timestamp': { order: 'desc' } }],
    query: {
      bool: {
        must: [
          {
            query_string: {
              query: options.query,
            },
          },
        ],
        filter: [] as Array<Record<string, unknown>>,
      },
    },
  };

  const filters = (searchBody.query as Record<string, any>).bool.filter as Array<
    Record<string, unknown>
  >;

  if (options.hostname) {
    filters.push({ term: { 'hostname.keyword': options.hostname } });
  }

  if (options.from || options.to) {
    const range: Record<string, string> = {};
    if (options.from) range.gte = options.from;
    if (options.to) range.lte = options.to;
    filters.push({ range: { '@timestamp': range } });
  }

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (config.KIBANA_API_KEY) {
      headers['Authorization'] = `ApiKey ${config.KIBANA_API_KEY}`;
    }

    const url = `${config.KIBANA_ENDPOINT}/_search`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(searchBody),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!response.ok) {
      log.error(
        { status: response.status, statusText: response.statusText },
        'Kibana/ES request failed',
      );
      return [];
    }

    const data = (await response.json()) as {
      hits?: {
        hits?: Array<{
          _source?: Record<string, unknown>;
        }>;
      };
    };

    const hits = data.hits?.hits || [];

    return hits.map((hit) => {
      const source = hit._source || {};
      return {
        timestamp: (source['@timestamp'] as string) || new Date().toISOString(),
        message: (source['message'] as string) || '',
        level: (source['level'] as string) || (source['log.level'] as string) || 'info',
        hostname: source['hostname'] as string | undefined,
        source: source['source'] as string | undefined,
        ...source,
      };
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      log.error('Kibana request timed out');
    } else {
      log.error({ err }, 'Failed to fetch logs from Kibana/ES');
    }
    return [];
  }
}
