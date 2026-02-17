import crypto from 'node:crypto';
import { getDbForDomain } from '../db/app-db-router.js';
import { hashPassword, comparePassword } from '../utils/crypto.js';
import { getConfig } from '../config/index.js';
import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('user-store');

export type Role = 'viewer' | 'operator' | 'admin';

export interface User {
  id: string;
  username: string;
  password_hash: string;
  role: Role;
  default_landing_page: string;
  created_at: string;
  updated_at: string;
}

export type UserSafe = Omit<User, 'password_hash'>;

const ROLE_LEVELS: Record<Role, number> = {
  viewer: 0,
  operator: 1,
  admin: 2,
};

export function roleLevel(role: Role): number {
  return ROLE_LEVELS[role] ?? 0;
}

export function hasMinRole(userRole: Role, minRole: Role): boolean {
  return roleLevel(userRole) >= roleLevel(minRole);
}

function toSafe(user: User): UserSafe {
  const { password_hash: _, ...safe } = user;
  return safe;
}

export async function getUserById(id: string): Promise<User | undefined> {
  const db = getDbForDomain('auth');
  return await db.queryOne<User>('SELECT * FROM users WHERE id = ?', [id]) ?? undefined;
}

export async function getUserByUsername(username: string): Promise<User | undefined> {
  const db = getDbForDomain('auth');
  return await db.queryOne<User>('SELECT * FROM users WHERE username = ?', [username]) ?? undefined;
}

export async function listUsers(): Promise<UserSafe[]> {
  const db = getDbForDomain('auth');
  const users = await db.query<User>('SELECT * FROM users ORDER BY created_at ASC', []);
  return users.map(toSafe);
}

export async function createUser(username: string, password: string, role: Role): Promise<UserSafe> {
  const db = getDbForDomain('auth');
  const id = crypto.randomUUID();
  const passwordHash = await hashPassword(password);
  await db.execute(`
    INSERT INTO users (id, username, password_hash, role, default_landing_page)
    VALUES (?, ?, ?, ?, '/')
  `, [id, username, passwordHash, role]);
  const user = (await getUserById(id))!;
  return toSafe(user);
}

export async function updateUser(
  id: string,
  updates: { username?: string; password?: string; role?: Role; default_landing_page?: string }
): Promise<UserSafe | undefined> {
  const db = getDbForDomain('auth');
  const existing = await getUserById(id);
  if (!existing) return undefined;

  const sets: string[] = [];
  const values: unknown[] = [];

  if (updates.username !== undefined) { sets.push('username = ?'); values.push(updates.username); }
  if (updates.password !== undefined) { sets.push('password_hash = ?'); values.push(await hashPassword(updates.password)); }
  if (updates.role !== undefined) { sets.push('role = ?'); values.push(updates.role); }
  if (updates.default_landing_page !== undefined) { sets.push('default_landing_page = ?'); values.push(updates.default_landing_page); }

  if (sets.length === 0) return toSafe(existing);

  sets.push('updated_at = NOW()');
  values.push(id);

  await db.execute(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, values);
  return toSafe((await getUserById(id))!);
}

export async function deleteUser(id: string): Promise<boolean> {
  const db = getDbForDomain('auth');
  const result = await db.execute('DELETE FROM users WHERE id = ?', [id]);
  return result.changes > 0;
}

export async function authenticateUser(username: string, password: string): Promise<User | null> {
  const user = await getUserByUsername(username);
  if (!user) return null;
  const valid = await comparePassword(password, user.password_hash);
  return valid ? user : null;
}

export async function getUserDefaultLandingPage(userId: string): Promise<string> {
  const user = await getUserById(userId);
  return user?.default_landing_page || '/';
}

export async function setUserDefaultLandingPage(userId: string, defaultLandingPage: string): Promise<boolean> {
  const db = getDbForDomain('auth');
  const result = await db.execute(`
    UPDATE users
    SET default_landing_page = ?, updated_at = NOW()
    WHERE id = ?
  `, [defaultLandingPage, userId]);
  return result.changes > 0;
}

/**
 * Upsert an OIDC-authenticated user. Creates a new user record if not found,
 * or updates the role if it has changed. Uses the OIDC `sub` claim as the user ID.
 * Returns the user and whether the role was changed.
 */
export async function upsertOIDCUser(
  sub: string,
  username: string,
  role: Role,
): Promise<{ user: UserSafe; roleChanged: boolean; previousRole?: Role }> {
  const db = getDbForDomain('auth');
  const existing = await getUserById(sub);

  if (existing) {
    if (existing.role === role) {
      return { user: toSafe(existing), roleChanged: false };
    }
    const previousRole = existing.role;
    await db.execute(`
      UPDATE users SET role = ?, username = ?, updated_at = NOW() WHERE id = ?
    `, [role, username, sub]);
    log.info({ sub, username, previousRole, newRole: role }, 'OIDC user role updated');
    return { user: toSafe((await getUserById(sub))!), roleChanged: true, previousRole };
  }

  // Create new OIDC user with a random password hash (OIDC users don't use password auth)
  const randomPlaceholder = crypto.randomUUID();
  await db.execute(`
    INSERT INTO users (id, username, password_hash, role, default_landing_page)
    VALUES (?, ?, ?, ?, '/')
  `, [sub, username, randomPlaceholder, role]);
  log.info({ sub, username, role }, 'OIDC user auto-provisioned');
  return { user: toSafe((await getUserById(sub))!), roleChanged: false };
}

export async function ensureDefaultAdmin(): Promise<void> {
  const config = getConfig();
  const existing = await getUserByUsername(config.DASHBOARD_USERNAME);
  if (existing) return;

  log.info({ username: config.DASHBOARD_USERNAME }, 'Creating default admin user from env vars');
  await createUser(config.DASHBOARD_USERNAME, config.DASHBOARD_PASSWORD, 'admin');
}
