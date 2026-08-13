import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetSetting = vi.fn();
const mockGetConfig = vi.fn();

// Kept: settings persistence is a PostgreSQL boundary unavailable in this unit test.
vi.mock('@dashboard/core/services/settings-store.js', () => ({
  getSetting: (...args: unknown[]) => mockGetSetting(...args),
}));

vi.mock('@dashboard/core/config/index.js', () => ({
  getConfig: () => mockGetConfig(),
}));

const { getElasticsearchConfig } = await import('../services/elasticsearch-config.js');

describe('getElasticsearchConfig outbound URL validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetConfig.mockReturnValue({
      KIBANA_ENDPOINT: undefined,
      KIBANA_API_KEY: undefined,
    });
    mockGetSetting.mockImplementation(async (key: string) => {
      const values: Record<string, string> = {
        'elasticsearch.enabled': 'true',
        'elasticsearch.endpoint': 'https://logs.example.com/',
        'elasticsearch.api_key': 'secret',
        'elasticsearch.index_pattern': 'logs-*',
        'elasticsearch.verify_ssl': 'true',
      };
      return values[key] === undefined ? null : { key, value: values[key] };
    });
  });

  it('returns a validated endpoint with trailing slashes removed', async () => {
    await expect(getElasticsearchConfig()).resolves.toEqual({
      enabled: true,
      endpoint: 'https://logs.example.com',
      apiKey: 'secret',
      indexPattern: 'logs-*',
      verifySsl: true,
    });
  });

  it('blocks a legacy private endpoint when configuration is consumed', async () => {
    mockGetSetting.mockImplementation(async (key: string) => {
      if (key === 'elasticsearch.enabled') return { key, value: 'true' };
      if (key === 'elasticsearch.endpoint') return { key, value: 'http://169.254.169.254/latest/meta-data' };
      return null;
    });

    await expect(getElasticsearchConfig()).resolves.toBeNull();
  });

  it('blocks an unsafe environment fallback too', async () => {
    mockGetSetting.mockResolvedValue(null);
    mockGetConfig.mockReturnValue({
      KIBANA_ENDPOINT: 'http://127.0.0.1:9200',
      KIBANA_API_KEY: 'secret',
    });

    await expect(getElasticsearchConfig()).resolves.toBeNull();
  });
});
