import crypto from 'node:crypto';
import { getDb } from '../db/sqlite.js';
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

export function getUserById(id: string): User | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id) as User | undefined;
}

export function getUserByUsername(username: string): User | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username) as User | undefined;
}

export function listUsers(): UserSafe[] {
  const db = getDb();
  const users = db.prepare('SELECT * FROM users ORDER BY created_at ASC').all() as User[];
  return users.map(toSafe);
}

export async function createUser(username: string, password: string, role: Role): Promise<UserSafe> {
  const db = getDb();
  const id = crypto.randomUUID();
  const passwordHash = await hashPassword(password);
  db.prepare(`
    INSERT INTO users (id, username, password_hash, role, default_landing_page)
    VALUES (?, ?, ?, ?, '/')
  `).run(id, username, passwordHash, role);
  const user = getUserById(id)!;
  return toSafe(user);
}

export async function updateUser(
  id: string,
  updates: { username?: string; password?: string; role?: Role; default_landing_page?: string }
): Promise<UserSafe | undefined> {
  const db = getDb();
  const existing = getUserById(id);
  if (!existing) return undefined;

  const sets: string[] = [];
  const values: unknown[] = [];

  if (updates.username !== undefined) { sets.push('username = ?'); values.push(updates.username); }
  if (updates.password !== undefined) { sets.push('password_hash = ?'); values.push(await hashPassword(updates.password)); }
  if (updates.role !== undefined) { sets.push('role = ?'); values.push(updates.role); }
  if (updates.default_landing_page !== undefined) { sets.push('default_landing_page = ?'); values.push(updates.default_landing_page); }

  if (sets.length === 0) return toSafe(existing);

  sets.push("updated_at = datetime('now')");
  values.push(id);

  db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  return toSafe(getUserById(id)!);
}

export function deleteUser(id: string): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM users WHERE id = ?').run(id);
  return result.changes > 0;
}

export async function authenticateUser(username: string, password: string): Promise<User | null> {
  const user = getUserByUsername(username);
  if (!user) return null;
  const valid = await comparePassword(password, user.password_hash);
  return valid ? user : null;
}

export function getUserDefaultLandingPage(userId: string): string {
  const user = getUserById(userId);
  return user?.default_landing_page || '/';
}

export function setUserDefaultLandingPage(userId: string, defaultLandingPage: string): boolean {
  const db = getDb();
  const result = db.prepare(`
    UPDATE users
    SET default_landing_page = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(defaultLandingPage, userId);
  return result.changes > 0;
}

export async function ensureDefaultAdmin(): Promise<void> {
  const db = getDb();
  const config = getConfig();
  const existing = getUserByUsername(config.DASHBOARD_USERNAME);
  if (existing) return;

  log.info({ username: config.DASHBOARD_USERNAME }, 'Creating default admin user from env vars');
  await createUser(config.DASHBOARD_USERNAME, config.DASHBOARD_PASSWORD, 'admin');
}
