import { readFileSync } from 'node:fs';
import { SignJWT, jwtVerify, importPKCS8, importSPKI, errors, type CryptoKey } from 'jose';
import bcrypt from 'bcrypt';
import { getConfig } from '../config/index.js';
import { createChildLogger } from './logger.js';

const log = createChildLogger('crypto');

/**
 * JWT Signing Algorithm Decision (Issue #312)
 *
 * This module defaults to HS256 (HMAC-SHA256, symmetric). This is the correct
 * choice for the current single-service architecture because:
 *
 * 1. Single backend — one service signs AND verifies, so a shared secret is
 *    simpler and sufficient (no key distribution problem).
 * 2. Performance — HS256 is ~10-20x faster than RS256 for signing operations.
 * 3. Key management — a single JWT_SECRET env var vs. PEM key pair rotation.
 * 4. Session store — tokens are validated against PostgreSQL sessions on every
 *    request, so even if a token were forged the session check would reject it.
 *
 * Revisit this decision when ANY of the following become true:
 *   - Multiple backend services need to independently verify JWTs
 *   - Token verification moves to an API gateway / edge proxy
 *   - A compliance audit mandates asymmetric signing (e.g. FIPS, SOC 2)
 *   - OIDC alignment requires consistent asymmetric key usage
 *
 * To switch: set JWT_ALGORITHM=RS256 (or ES256) and provide JWT_PRIVATE_KEY_PATH
 * + JWT_PUBLIC_KEY_PATH pointing to PEM-encoded key files.
 */

const SALT_ROUNDS = 12;

let cachedSigningKey: CryptoKey | Uint8Array | null = null;
let cachedVerifyKey: CryptoKey | Uint8Array | null = null;

function getSymmetricKey(): Uint8Array {
  return new TextEncoder().encode(getConfig().JWT_SECRET);
}

async function getSigningKey(): Promise<CryptoKey | Uint8Array> {
  if (cachedSigningKey) return cachedSigningKey;

  const { JWT_ALGORITHM, JWT_PRIVATE_KEY_PATH } = getConfig();

  if (JWT_ALGORITHM === 'HS256') {
    cachedSigningKey = getSymmetricKey();
  } else {
    const pem = readFileSync(JWT_PRIVATE_KEY_PATH!, 'utf-8');
    cachedSigningKey = await importPKCS8(pem, JWT_ALGORITHM);
  }

  return cachedSigningKey;
}

async function getVerifyKey(): Promise<CryptoKey | Uint8Array> {
  if (cachedVerifyKey) return cachedVerifyKey;

  const { JWT_ALGORITHM, JWT_PUBLIC_KEY_PATH } = getConfig();

  if (JWT_ALGORITHM === 'HS256') {
    cachedVerifyKey = getSymmetricKey();
  } else {
    const pem = readFileSync(JWT_PUBLIC_KEY_PATH!, 'utf-8');
    cachedVerifyKey = await importSPKI(pem, JWT_ALGORITHM);
  }

  return cachedVerifyKey;
}

/** Exposed for testing — clears cached key material so config changes take effect. */
export function _resetKeyCache(): void {
  cachedSigningKey = null;
  cachedVerifyKey = null;
}

export async function signJwt(payload: {
  sub: string;
  username: string;
  sessionId: string;
  role?: string;
}): Promise<string> {
  const { JWT_ALGORITHM, JWT_TOKEN_EXPIRY_MINUTES } = getConfig();
  const key = await getSigningKey();

  return new SignJWT(payload)
    .setProtectedHeader({ alg: JWT_ALGORITHM })
    .setIssuedAt()
    .setExpirationTime(`${JWT_TOKEN_EXPIRY_MINUTES}m`)
    .sign(key);
}

export async function verifyJwt(token: string) {
  try {
    const { JWT_ALGORITHM } = getConfig();
    const key = await getVerifyKey();
    const { payload } = await jwtVerify(token, key, {
      algorithms: [JWT_ALGORITHM],
      requiredClaims: ['sub', 'exp', 'iat'],
    });
    return payload as { sub: string; username: string; sessionId: string; role?: string; exp: number; iat: number };
  } catch (err) {
    // jose-specific errors represent the normal "invalid token" failure mode
    // (expired, bad signature, wrong algorithm, missing claim, malformed JWT).
    // We return null silently — these are routine and should not produce log spam
    // on every failed auth attempt.
    if (err instanceof errors.JOSEError) {
      return null;
    }
    // Anything else is unexpected: a key-import failure, missing key file, an
    // invariant violation in our own code, etc. These indicate operational or
    // configuration issues that operators must see in logs.
    log.error({ err }, 'JWT verification failed with unexpected error');
    return null;
  }
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function comparePassword(
  password: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}
