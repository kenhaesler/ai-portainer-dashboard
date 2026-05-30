import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// vi.mock factories are hoisted; bind the mock fns via vi.hoisted so the
// test body can assert on them later.
const { discoveryMock, allowInsecureRequestsMock } = vi.hoisted(() => ({
  discoveryMock: vi.fn().mockResolvedValue({ __fake: 'config' }),
  allowInsecureRequestsMock: vi.fn(),
}));

vi.mock('openid-client', () => ({
  discovery: discoveryMock,
  allowInsecureRequests: allowInsecureRequestsMock,
  ClientSecretBasic: vi.fn((secret: string) => ({ __auth: secret })),
  randomPKCECodeVerifier: vi.fn(() => 'v'),
  calculatePKCECodeChallenge: vi.fn(async () => 'c'),
  randomState: vi.fn(() => 's'),
  randomNonce: vi.fn(() => 'n'),
  buildAuthorizationUrl: vi.fn(() => new URL('https://idp.example.com/authz')),
  authorizationCodeGrant: vi.fn(),
}));

// Stub the settings DB read so we drive `oidc.allow_insecure_transport`
// directly from the test.
const settingsRows: { key: string; value: string }[] = [];
vi.mock('../db/app-db-router.js', () => ({
  getDbForDomain: () => ({
    query: vi.fn(async () => settingsRows.slice()),
  }),
}));

import { generateAuthorizationUrl, invalidateOIDCCache } from './oidc.js';

function seedSettings(overrides: Record<string, string>) {
  settingsRows.length = 0;
  const defaults: Record<string, string> = {
    'oidc.enabled': 'true',
    'oidc.issuer_url': 'http://idp.example.com',
    'oidc.client_id': 'client',
    'oidc.client_secret': 'secret',
    'oidc.scopes': 'openid profile email',
  };
  for (const [key, value] of Object.entries({ ...defaults, ...overrides })) {
    settingsRows.push({ key, value });
  }
}

describe('OIDC insecure-transport opt-in', () => {
  beforeEach(() => {
    discoveryMock.mockClear();
    allowInsecureRequestsMock.mockClear();
    invalidateOIDCCache();
  });

  afterEach(() => {
    invalidateOIDCCache();
  });

  it('passes allowInsecureRequests to discovery when the flag is on', async () => {
    seedSettings({ 'oidc.allow_insecure_transport': 'true' });

    await generateAuthorizationUrl('https://app.example.com/auth/callback', 'openid');

    expect(discoveryMock).toHaveBeenCalledTimes(1);
    const lastCall = discoveryMock.mock.calls[0];
    const opts = lastCall[4];
    expect(opts).toBeDefined();
    expect(opts.execute).toBeDefined();
    expect(opts.execute).toHaveLength(1);
    // The execute hook must be openid-client's allowInsecureRequests symbol.
    expect(opts.execute[0]).toBe(allowInsecureRequestsMock);

    // Post-discovery extension to token exchange also fires.
    expect(allowInsecureRequestsMock).toHaveBeenCalledTimes(1);
    expect(allowInsecureRequestsMock).toHaveBeenCalledWith({ __fake: 'config' });
  });

  it('omits the option entirely when the flag is off (default)', async () => {
    seedSettings({ 'oidc.allow_insecure_transport': 'false' });

    await generateAuthorizationUrl('https://app.example.com/auth/callback', 'openid');

    expect(discoveryMock).toHaveBeenCalledTimes(1);
    const opts = discoveryMock.mock.calls[0][4];
    expect(opts).toBeUndefined();
    expect(allowInsecureRequestsMock).not.toHaveBeenCalled();
  });

  it('defaults to off when the setting is missing', async () => {
    seedSettings({}); // no allow_insecure_transport key at all

    await generateAuthorizationUrl('https://app.example.com/auth/callback', 'openid');

    const opts = discoveryMock.mock.calls[0][4];
    expect(opts).toBeUndefined();
    expect(allowInsecureRequestsMock).not.toHaveBeenCalled();
  });
});
