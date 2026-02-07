import { getConfig } from '../config/index.js';
import { getSetting } from './settings-store.js';

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

export function getElasticsearchConfig(): ElasticsearchConfig | null {
  const config = getConfig();

  const enabled = getSetting('elasticsearch.enabled')?.value === 'true';
  const endpoint = cleanEndpoint(getSetting('elasticsearch.endpoint')?.value);
  const apiKey = (getSetting('elasticsearch.api_key')?.value ?? '').trim();
  const indexPattern = (getSetting('elasticsearch.index_pattern')?.value ?? 'logs-*').trim() || 'logs-*';
  const verifySsl = getSetting('elasticsearch.verify_ssl')?.value !== 'false';

  if (enabled && endpoint) {
    return {
      enabled: true,
      endpoint,
      apiKey,
      indexPattern,
      verifySsl,
    };
  }

  if (config.KIBANA_ENDPOINT) {
    return {
      enabled: true,
      endpoint: cleanEndpoint(config.KIBANA_ENDPOINT),
      apiKey: config.KIBANA_API_KEY || '',
      indexPattern: 'logs-*',
      verifySsl: true,
    };
  }

  return null;
}
