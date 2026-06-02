import { describe, it, expect, vi } from 'vitest';

// External dependency — never reachable in CI.
vi.mock('openid-client', () => ({}));

// Drive the settings DB read directly from the test.
const settingsRows: { key: string; value: string }[] = [];
vi.mock('../db/app-db-router.js', () => ({
  getDbForDomain: () => ({
    query: vi.fn(async () => settingsRows.slice()),
  }),
}));

import { getOIDCConfig } from './oidc.js';

function seedSettings(overrides: Record<string, string>) {
  settingsRows.length = 0;
  const defaults: Record<string, string> = {
    'oidc.enabled': 'true',
    'oidc.issuer_url': 'https://idp.example.com',
    'oidc.client_id': 'client',
    'oidc.client_secret': 'secret',
  };
  for (const [key, value] of Object.entries({ ...defaults, ...overrides })) {
    settingsRows.push({ key, value });
  }
}

describe('getOIDCConfig allow_unmapped_viewer parsing', () => {
  it('parses "true" as allow_unmapped_viewer === true', async () => {
    seedSettings({ 'oidc.allow_unmapped_viewer': 'true' });
    const config = await getOIDCConfig();
    expect(config.allow_unmapped_viewer).toBe(true);
  });

  it('parses "false" as allow_unmapped_viewer === false', async () => {
    seedSettings({ 'oidc.allow_unmapped_viewer': 'false' });
    const config = await getOIDCConfig();
    expect(config.allow_unmapped_viewer).toBe(false);
  });

  it('defaults to false (restrictive) when the setting is missing', async () => {
    seedSettings({}); // no allow_unmapped_viewer key at all
    const config = await getOIDCConfig();
    expect(config.allow_unmapped_viewer).toBe(false);
  });
});
