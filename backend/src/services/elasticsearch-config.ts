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

export async function getElasticsearchConfig(): Promise<ElasticsearchConfig | null> {
  const config = getConfig();

  const enabled = (await getSetting('elasticsearch.enabled'))?.value === 'true';
  const endpoint = cleanEndpoint((await getSetting('elasticsearch.endpoint'))?.value);
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
