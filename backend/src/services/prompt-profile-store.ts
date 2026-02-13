import { getDb } from '../db/sqlite.js';
import { getSetting, setSetting, deleteSetting } from './settings-store.js';
import { createChildLogger } from '../utils/logger.js';
import { PROMPT_FEATURES, type PromptFeature } from './prompt-store.js';

const log = createChildLogger('prompt-profile-store');

// ── Types ────────────────────────────────────────────────────────────

export interface PromptProfileFeatureConfig {
  systemPrompt: string;
  model?: string;
  temperature?: number;
}

export interface PromptProfile {
  id: string;
  name: string;
  description: string;
  isBuiltIn: boolean;
  prompts: Record<string, PromptProfileFeatureConfig>;
  createdAt: string;
  updatedAt: string;
}

interface PromptProfileRow {
  id: string;
  name: string;
  description: string;
  is_built_in: number;
  prompts_json: string;
  created_at: string;
  updated_at: string;
}

const ACTIVE_PROFILE_KEY = 'prompts.active_profile';

// ── Helpers ──────────────────────────────────────────────────────────

function rowToProfile(row: PromptProfileRow): PromptProfile {
  let prompts: Record<string, PromptProfileFeatureConfig> = {};
  try {
    prompts = JSON.parse(row.prompts_json);
  } catch {
    log.warn({ id: row.id }, 'Failed to parse prompts_json, using empty object');
  }
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    isBuiltIn: row.is_built_in === 1,
    prompts,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function generateId(): string {
  return crypto.randomUUID();
}

// ── CRUD Operations ──────────────────────────────────────────────────

export function getAllProfiles(): PromptProfile[] {
  const db = getDb();
  const rows = db
    .prepare('SELECT * FROM prompt_profiles ORDER BY is_built_in DESC, name ASC')
    .all() as PromptProfileRow[];
  return rows.map(rowToProfile);
}

export function getProfileById(id: string): PromptProfile | undefined {
  const db = getDb();
  const row = db
    .prepare('SELECT * FROM prompt_profiles WHERE id = ?')
    .get(id) as PromptProfileRow | undefined;
  return row ? rowToProfile(row) : undefined;
}

export function createProfile(
  name: string,
  description: string,
  prompts: Record<string, PromptProfileFeatureConfig>,
): PromptProfile {
  const db = getDb();
  const id = generateId();
  const promptsJson = JSON.stringify(prompts);

  db.prepare(`
    INSERT INTO prompt_profiles (id, name, description, is_built_in, prompts_json, created_at, updated_at)
    VALUES (?, ?, ?, 0, ?, datetime('now'), datetime('now'))
  `).run(id, name, description, promptsJson);

  log.info({ id, name }, 'Profile created');

  return getProfileById(id)!;
}

export function updateProfile(
  id: string,
  updates: {
    name?: string;
    description?: string;
    prompts?: Record<string, PromptProfileFeatureConfig>;
  },
): PromptProfile | undefined {
  const db = getDb();
  const existing = getProfileById(id);
  if (!existing) return undefined;

  const name = updates.name ?? existing.name;
  const description = updates.description ?? existing.description;
  const prompts = updates.prompts ?? existing.prompts;
  const promptsJson = JSON.stringify(prompts);

  db.prepare(`
    UPDATE prompt_profiles
    SET name = ?, description = ?, prompts_json = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(name, description, promptsJson, id);

  log.info({ id, name }, 'Profile updated');

  return getProfileById(id);
}

export function deleteProfile(id: string): boolean {
  const db = getDb();
  const profile = getProfileById(id);

  if (!profile) return false;
  if (profile.isBuiltIn) {
    log.warn({ id }, 'Cannot delete built-in profile');
    return false;
  }

  // If deleting the active profile, switch to default
  const activeId = getActiveProfileId();
  if (activeId === id) {
    switchProfile('default');
  }

  const result = db.prepare('DELETE FROM prompt_profiles WHERE id = ? AND is_built_in = 0').run(id);
  if (result.changes > 0) {
    log.info({ id, name: profile.name }, 'Profile deleted');
    return true;
  }
  return false;
}

export function duplicateProfile(sourceId: string, newName: string): PromptProfile | undefined {
  const source = getProfileById(sourceId);
  if (!source) return undefined;

  return createProfile(newName, source.description, { ...source.prompts });
}

// ── Active profile ───────────────────────────────────────────────────

export function getActiveProfileId(): string {
  const setting = getSetting(ACTIVE_PROFILE_KEY);
  return setting?.value || 'default';
}

export function getActiveProfile(): PromptProfile | undefined {
  const id = getActiveProfileId();
  return getProfileById(id);
}

export function switchProfile(id: string): boolean {
  const profile = getProfileById(id);
  if (!profile) return false;

  // Clear per-feature prompt overrides so the new profile's prompts take effect
  for (const feature of PROMPT_FEATURES) {
    deleteSetting(`prompts.${feature.key}.system_prompt`);
    deleteSetting(`prompts.${feature.key}.model`);
    deleteSetting(`prompts.${feature.key}.temperature`);
  }

  setSetting(ACTIVE_PROFILE_KEY, id, 'prompts');
  log.info({ id, name: profile.name }, 'Switched active profile (per-feature overrides cleared)');
  return true;
}

// ── Prompt resolution from active profile ────────────────────────────

/**
 * Get the prompt config for a specific feature from the active profile.
 * Returns undefined if the active profile has no override for this feature.
 */
export function getProfilePromptConfig(feature: PromptFeature): PromptProfileFeatureConfig | undefined {
  const profile = getActiveProfile();
  if (!profile) return undefined;

  // The "default" profile has empty prompts ({}) which means "use defaults"
  const config = profile.prompts[feature];
  if (!config) return undefined;

  // If systemPrompt is empty string, treat as "no override"
  if (!config.systemPrompt || config.systemPrompt.trim().length === 0) {
    // Still return if there are model/temperature overrides
    if (config.model || config.temperature !== undefined) {
      return config;
    }
    return undefined;
  }

  return config;
}
