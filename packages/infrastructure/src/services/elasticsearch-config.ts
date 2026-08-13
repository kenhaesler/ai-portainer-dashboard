import { getConfig } from '@dashboard/core/config/index.js';
import { getSetting } from '@dashboard/core/services/settings-store.js';
import { validateOutboundUrl } from '@dashboard/core/utils/network-security.js';
import { createChildLogger } from '@dashboard/core/utils/logger.js';

const log = createChildLogger('elasticsearch-config');

export interface ElasticsearchConfig {
  enabled: boolean;
  endpoint: string;
  apiKey: string;
  indexPattern: string;
  verifySsl: boolean;
}

function cleanEndpoint(value: string | undefined): string {
  return (value ?? '').trim().replace(/\/+$/, '');
}

function safeEndpoint(value: string | undefined): string | null {
  const endpoint = cleanEndpoint(value);
  if (!endpoint) return null;

  const validationError = validateOutboundUrl(endpoint, 'Elasticsearch endpoint');
  if (validationError) {
    log.warn({ reason: validationError }, 'Ignoring unsafe Elasticsearch endpoint');
    return null;
  }
  return endpoint;
}

export async function getElasticsearchConfig(): Promise<ElasticsearchConfig | null> {
  const config = getConfig();

  const enabled = (await getSetting('elasticsearch.enabled'))?.value === 'true';
  const endpoint = safeEndpoint((await getSetting('elasticsearch.endpoint'))?.value);
  const apiKey = ((await getSetting('elasticsearch.api_key'))?.value ?? '').trim();
  const indexPattern = ((await getSetting('elasticsearch.index_pattern'))?.value ?? 'logs-*').trim() || 'logs-*';
  const verifySsl = (await getSetting('elasticsearch.verify_ssl'))?.value !== 'false';

  if (enabled && endpoint) {
    return {
      enabled: true,
      endpoint,
      apiKey,
      indexPattern,
      verifySsl,
    };
  }

  const envEndpoint = safeEndpoint(config.KIBANA_ENDPOINT);
  if (envEndpoint) {
    return {
      enabled: true,
      endpoint: envEndpoint,
      apiKey: config.KIBANA_API_KEY || '',
      indexPattern: 'logs-*',
      verifySsl: true,
    };
  }

  return null;
}
