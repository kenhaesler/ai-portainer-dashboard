import { SignJWT, jwtVerify } from 'jose';
import bcrypt from 'bcrypt';
import { getConfig } from '../config/index.js';

const SALT_ROUNDS = 12;

function getSecretKey(): Uint8Array {
  return new TextEncoder().encode(getConfig().JWT_SECRET);
}

export async function signJwt(payload: {
  sub: string;
  username: string;
  sessionId: string;
  role?: string;
}): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('60m')
    .sign(getSecretKey());
}

export async function verifyJwt(token: string) {
  try {
    const { payload } = await jwtVerify(token, getSecretKey());
    return payload as { sub: string; username: string; sessionId: string; role?: string; exp: number; iat: number };
  } catch {
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
