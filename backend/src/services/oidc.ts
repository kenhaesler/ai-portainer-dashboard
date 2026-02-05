import * as client from 'openid-client';
import { getDb } from '../db/sqlite.js';
import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('oidc');

interface OIDCConfig {
  enabled: boolean;
  issuer_url: string;
  client_id: string;
  client_secret: string;
  redirect_uri: string;
  scopes: string;
  local_auth_enabled: boolean;
}

interface StateEntry {
  codeVerifier: string;
  nonce: string;
  createdAt: number;
}

interface AuthUrlResult {
  url: string;
  state: string;
}

interface TokenClaims {
  sub: string;
  email?: string;
  name?: string;
}

// In-memory state store (code verifier + nonce per auth request)
const stateStore = new Map<string, StateEntry>();

// Cached OIDC server configuration
let cachedConfig: client.Configuration | null = null;
let cachedConfigExpiry = 0;

const STATE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const CONFIG_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Clean expired state entries. Called on each request.
 */
function cleanExpiredStates(): void {
  const now = Date.now();
  for (const [key, entry] of stateStore) {
    if (now - entry.createdAt > STATE_TTL_MS) {
      stateStore.delete(key);
    }
  }
}

/**
 * Read OIDC settings from the SQLite settings table.
 */
export function getOIDCConfig(): OIDCConfig {
  const db = getDb();
  const rows = db
    .prepare("SELECT key, value FROM settings WHERE category = 'authentication'")
    .all() as Array<{ key: string; value: string }>;

  const settings: Record<string, string> = {};
  for (const row of rows) {
    settings[row.key] = row.value;
  }

  return {
    enabled: settings['oidc.enabled'] === 'true',
    issuer_url: settings['oidc.issuer_url'] || '',
    client_id: settings['oidc.client_id'] || '',
    client_secret: settings['oidc.client_secret'] || '',
    redirect_uri: settings['oidc.redirect_uri'] || '',
    scopes: settings['oidc.scopes'] || 'openid profile email',
    local_auth_enabled: settings['oidc.local_auth_enabled'] !== 'false',
  };
}

/**
 * Check if OIDC is enabled and has required fields configured.
 */
export function isOIDCEnabled(): boolean {
  const config = getOIDCConfig();
  return config.enabled && !!config.issuer_url && !!config.client_id && !!config.client_secret;
}

/**
 * Get or create the OIDC discovery configuration, cached for 1 hour.
 */
async function getOrCreateConfiguration(): Promise<client.Configuration> {
  const oidcConfig = getOIDCConfig();

  if (cachedConfig && Date.now() < cachedConfigExpiry) {
    return cachedConfig;
  }

  log.info({ issuer: oidcConfig.issuer_url }, 'Discovering OIDC configuration');

  const issuerUrl = new URL(oidcConfig.issuer_url);
  cachedConfig = await client.discovery(
    issuerUrl,
    oidcConfig.client_id,
    oidcConfig.client_secret,
    client.ClientSecretBasic(oidcConfig.client_secret)
  );

  cachedConfigExpiry = Date.now() + CONFIG_CACHE_TTL_MS;
  log.info('OIDC configuration discovered and cached');

  return cachedConfig;
}

/**
 * Invalidate the cached OIDC configuration (e.g., when settings change).
 */
export function invalidateOIDCCache(): void {
  cachedConfig = null;
  cachedConfigExpiry = 0;
}

/**
 * Generate an authorization URL with PKCE, state, and nonce.
 */
export async function generateAuthorizationUrl(redirectUri: string, scopes: string): Promise<AuthUrlResult> {
  cleanExpiredStates();

  const config = await getOrCreateConfiguration();

  const codeVerifier = client.randomPKCECodeVerifier();
  const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);
  const state = client.randomState();
  const nonce = client.randomNonce();

  // Store state → code_verifier + nonce mapping server-side
  stateStore.set(state, {
    codeVerifier,
    nonce,
    createdAt: Date.now(),
  });

  const parameters: Record<string, string> = {
    redirect_uri: redirectUri,
    scope: scopes,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state,
    nonce,
    response_type: 'code',
  };

  const url = client.buildAuthorizationUrl(config, parameters);

  log.info({ state }, 'Authorization URL generated');
  return { url: url.href, state };
}

/**
 * Exchange an authorization code for tokens and return user claims.
 */
export async function exchangeCode(
  callbackUrl: string,
  expectedState: string,
): Promise<TokenClaims> {
  cleanExpiredStates();

  const stateEntry = stateStore.get(expectedState);
  if (!stateEntry) {
    throw new Error('Invalid or expired state parameter');
  }

  // Remove used state
  stateStore.delete(expectedState);

  const config = await getOrCreateConfiguration();

  const tokens = await client.authorizationCodeGrant(
    config,
    new URL(callbackUrl),
    {
      pkceCodeVerifier: stateEntry.codeVerifier,
      expectedState,
      expectedNonce: stateEntry.nonce,
    },
  );

  log.info('Authorization code exchanged for tokens');

  const claims = tokens.claims();
  if (!claims) {
    throw new Error('No claims in ID token');
  }

  return {
    sub: claims.sub,
    email: claims.email as string | undefined,
    name: claims.name as string | undefined,
  };
}
