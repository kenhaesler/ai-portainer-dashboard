import * as client from 'openid-client';
import { getDbForDomain } from '../db/app-db-router.js';
import { createChildLogger } from '../utils/logger.js';
import type { Role } from './user-store.js';

const log = createChildLogger('oidc');

interface OIDCConfig {
  enabled: boolean;
  issuer_url: string;
  client_id: string;
  client_secret: string;
  redirect_uri: string;
  scopes: string;
  local_auth_enabled: boolean;
  groups_claim: string;
  group_role_mappings: Record<string, Role>;
  auto_provision: boolean;
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

export interface TokenClaims {
  sub: string;
  email?: string;
  name?: string;
  groups?: string[];
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
 * Read OIDC settings from the settings table.
 */
export async function getOIDCConfig(): Promise<OIDCConfig> {
  const settingsDb = getDbForDomain('settings');
  const rows = await settingsDb.query<{ key: string; value: string }>(
    "SELECT key, value FROM settings WHERE category = 'authentication'",
  );

  const settings: Record<string, string> = {};
  for (const row of rows) {
    settings[row.key] = row.value;
  }

  let groupRoleMappings: Record<string, Role> = {};
  try {
    const raw = settings['oidc.group_role_mappings'];
    if (raw) {
      const parsed = JSON.parse(raw);
      if (typeof parsed === 'object' && parsed !== null) {
        groupRoleMappings = parsed as Record<string, Role>;
      }
    }
  } catch {
    log.warn('Invalid oidc.group_role_mappings JSON, using empty mappings');
  }

  return {
    enabled: settings['oidc.enabled'] === 'true',
    issuer_url: settings['oidc.issuer_url'] || '',
    client_id: settings['oidc.client_id'] || '',
    client_secret: settings['oidc.client_secret'] || '',
    redirect_uri: settings['oidc.redirect_uri'] || '',
    scopes: settings['oidc.scopes'] || 'openid profile email',
    local_auth_enabled: settings['oidc.local_auth_enabled'] !== 'false',
    groups_claim: settings['oidc.groups_claim'] || 'groups',
    group_role_mappings: groupRoleMappings,
    auto_provision: settings['oidc.auto_provision'] !== 'false',
  };
}

/**
 * Check if OIDC is enabled and has required fields configured.
 */
export async function isOIDCEnabled(): Promise<boolean> {
  const config = await getOIDCConfig();
  return config.enabled && !!config.issuer_url && !!config.client_id && !!config.client_secret;
}

/**
 * Get or create the OIDC discovery configuration, cached for 1 hour.
 */
async function getOrCreateConfiguration(): Promise<client.Configuration> {
  const oidcConfig = await getOIDCConfig();

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

const VALID_ROLES: ReadonlySet<string> = new Set(['viewer', 'operator', 'admin']);

const ROLE_PRIORITY: Record<Role, number> = {
  viewer: 0,
  operator: 1,
  admin: 2,
};

/**
 * Resolve the highest-privilege role from a user's groups using the configured mappings.
 * Returns undefined if no mapping matches (including wildcard).
 */
export function resolveRoleFromGroups(
  groups: string[],
  mappings: Record<string, Role>,
): Role | undefined {
  if (!groups.length || !Object.keys(mappings).length) {
    return undefined;
  }

  let bestRole: Role | undefined;
  let bestPriority = -1;

  for (const group of groups) {
    const sanitized = group.trim();
    if (!sanitized) continue;

    const mappedRole = mappings[sanitized];
    if (mappedRole && VALID_ROLES.has(mappedRole)) {
      const priority = ROLE_PRIORITY[mappedRole];
      if (priority > bestPriority) {
        bestRole = mappedRole;
        bestPriority = priority;
      }
    }
  }

  // Check wildcard fallback only if no explicit match
  if (!bestRole && '*' in mappings && VALID_ROLES.has(mappings['*'])) {
    bestRole = mappings['*'];
  }

  return bestRole;
}

/**
 * Extract groups from ID token claims using the configured claim name.
 * Validates that the claim value is an array of strings.
 */
export function extractGroups(
  claims: Record<string, unknown>,
  groupsClaim: string,
): string[] {
  const raw = claims[groupsClaim];
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw.filter((item): item is string => typeof item === 'string');
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

  const oidcConfig = await getOIDCConfig();
  const groups = extractGroups(
    claims as unknown as Record<string, unknown>,
    oidcConfig.groups_claim,
  );

  if (groups.length > 0) {
    log.info({ groups, claim: oidcConfig.groups_claim }, 'Extracted groups from ID token');
  }

  return {
    sub: claims.sub,
    email: claims.email as string | undefined,
    name: claims.name as string | undefined,
    groups,
  };
}
