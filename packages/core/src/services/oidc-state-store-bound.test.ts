import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Regression for the DoS opened by #1386: exempting `GET /api/auth/oidc/status`
// from the global rate limit removed the only throttle on the unauthenticated,
// side-effecting status endpoint. When OIDC is enabled, that GET calls
// generateAuthorizationUrl(), which inserts an entry into the in-memory
// `stateStore` Map. Without a size cap an attacker could hammer the status GET
// to inflate the Map within the 5-minute TTL window = memory-pressure DoS.
//
// The fix bounds the Map at OIDC_STATE_STORE_MAX. This test proves the Map can
// never grow past the cap regardless of insertion rate, while a freshly-inserted
// state remains retrievable (eviction targets the OLDEST entry, not the newest).

// vi.mock factories are hoisted; bind a per-call unique state generator so each
// generateAuthorizationUrl() insertion lands under a distinct key.
const { stateCounter } = vi.hoisted(() => ({ stateCounter: { n: 0 } }));

vi.mock('openid-client', () => ({
  discovery: vi.fn().mockResolvedValue({ __fake: 'config' }),
  allowInsecureRequests: vi.fn(),
  ClientSecretBasic: vi.fn((secret: string) => ({ __auth: secret })),
  randomPKCECodeVerifier: vi.fn(() => 'verifier'),
  calculatePKCECodeChallenge: vi.fn(async () => 'challenge'),
  randomState: vi.fn(() => `state-${stateCounter.n++}`),
  randomNonce: vi.fn(() => 'nonce'),
  buildAuthorizationUrl: vi.fn(() => new URL('https://idp.example.com/authz')),
  authorizationCodeGrant: vi.fn(),
  fetchUserInfo: vi.fn(),
}));

// Drive the settings DB read in-process so OIDC reads as enabled without a real DB.
const settingsRows: { key: string; value: string }[] = [
  { key: 'oidc.enabled', value: 'true' },
  { key: 'oidc.issuer_url', value: 'http://idp.example.com' },
  { key: 'oidc.client_id', value: 'client' },
  { key: 'oidc.client_secret', value: 'secret' },
  { key: 'oidc.scopes', value: 'openid profile email' },
];
vi.mock('../db/app-db-router.js', () => ({
  getDbForDomain: () => ({
    query: vi.fn(async () => settingsRows.slice()),
  }),
}));

import {
  generateAuthorizationUrl,
  invalidateOIDCCache,
  OIDC_STATE_STORE_MAX,
  __getStateStoreStatsForTest,
} from './oidc.js';

describe('OIDC state store is bounded (DoS via exempted status GET — #1386)', () => {
  beforeEach(() => {
    invalidateOIDCCache();
    stateCounter.n = 0;
    __getStateStoreStatsForTest().clear();
  });

  afterEach(() => {
    invalidateOIDCCache();
    __getStateStoreStatsForTest().clear();
  });

  it('exposes a generous hard cap far above legitimate concurrent logins', () => {
    expect(OIDC_STATE_STORE_MAX).toBeGreaterThanOrEqual(10_000);
  });

  it('never grows past OIDC_STATE_STORE_MAX no matter how many states are inserted', async () => {
    const overflow = OIDC_STATE_STORE_MAX + 250;

    for (let i = 0; i < overflow; i++) {
      await generateAuthorizationUrl('https://app.example.com/auth/callback', 'openid');
      // Invariant must hold on EVERY insertion, not just at the end.
      expect(__getStateStoreStatsForTest().size()).toBeLessThanOrEqual(OIDC_STATE_STORE_MAX);
    }

    expect(__getStateStoreStatsForTest().size()).toBe(OIDC_STATE_STORE_MAX);
  });

  it('evicts the OLDEST state on overflow, keeping freshly-inserted login state retrievable', async () => {
    // Fill exactly to the cap; record the first (oldest) state inserted.
    const firstResult = await generateAuthorizationUrl('https://app.example.com/auth/callback', 'openid');
    for (let i = 1; i < OIDC_STATE_STORE_MAX; i++) {
      await generateAuthorizationUrl('https://app.example.com/auth/callback', 'openid');
    }
    expect(__getStateStoreStatsForTest().size()).toBe(OIDC_STATE_STORE_MAX);
    expect(__getStateStoreStatsForTest().has(firstResult.state)).toBe(true);

    // One more insertion overflows the cap: the oldest must be evicted and the
    // newest must survive (a legitimate in-flight login still completes).
    const newest = await generateAuthorizationUrl('https://app.example.com/auth/callback', 'openid');

    expect(__getStateStoreStatsForTest().size()).toBe(OIDC_STATE_STORE_MAX);
    expect(__getStateStoreStatsForTest().has(firstResult.state)).toBe(false); // oldest evicted
    expect(__getStateStoreStatsForTest().has(newest.state)).toBe(true); // newest retained
  });
});
