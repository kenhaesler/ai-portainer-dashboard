import { getDbForDomain } from '../../../core/db/app-db-router.js';
import { getSetting, setSetting, deleteSetting } from '../../../core/services/settings-store.js';
import { createChildLogger } from '../../../core/utils/logger.js';
import { PROMPT_FEATURES, type PromptFeature } from './prompt-store.js';

const log = createChildLogger('prompt-profile-store');

function db() { return getDbForDomain('prompts'); }

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
  is_built_in: boolean;
  prompts_json: string | Record<string, unknown>; // JSONB: pg driver auto-parses to object
  created_at: string;
  updated_at: string;
}

const ACTIVE_PROFILE_KEY = 'prompts.active_profile';

// ── Helpers ──────────────────────────────────────────────────────────

function parsePromptsJson(raw: string | Record<string, unknown>, id: string): Record<string, PromptProfileFeatureConfig> {
  // pg driver auto-deserializes JSONB columns into native JS objects.
  // Handle both: object (from pg) and string (defensive / tests).
  if (typeof raw === 'object' && raw !== null) {
    return raw as Record<string, PromptProfileFeatureConfig>;
  }
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      log.warn({ id }, 'Failed to parse prompts_json string, using empty object');
    }
  }
  return {};
}

function rowToProfile(row: PromptProfileRow): PromptProfile {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    isBuiltIn: !!row.is_built_in,
    prompts: parsePromptsJson(row.prompts_json, row.id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function generateId(): string {
  return crypto.randomUUID();
}

// ── CRUD Operations ──────────────────────────────────────────────────

export async function getAllProfiles(): Promise<PromptProfile[]> {
  const rows = await db().query<PromptProfileRow>(
    'SELECT * FROM prompt_profiles ORDER BY is_built_in DESC, name ASC',
  );
  return rows.map(rowToProfile);
}

export async function getProfileById(id: string): Promise<PromptProfile | undefined> {
  const row = await db().queryOne<PromptProfileRow>(
    'SELECT * FROM prompt_profiles WHERE id = ?', [id],
  );
  return row ? rowToProfile(row) : undefined;
}

export async function createProfile(
  name: string,
  description: string,
  prompts: Record<string, PromptProfileFeatureConfig>,
): Promise<PromptProfile> {
  const id = generateId();
  const promptsJson = JSON.stringify(prompts);

  await db().execute(`
    INSERT INTO prompt_profiles (id, name, description, is_built_in, prompts_json, created_at, updated_at)
    VALUES (?, ?, ?, false, ?, NOW(), NOW())
  `, [id, name, description, promptsJson]);

  log.info({ id, name }, 'Profile created');

  return (await getProfileById(id))!;
}

export async function updateProfile(
  id: string,
  updates: {
    name?: string;
    description?: string;
    prompts?: Record<string, PromptProfileFeatureConfig>;
  },
): Promise<PromptProfile | undefined> {
  const existing = await getProfileById(id);
  if (!existing) return undefined;

  const name = updates.name ?? existing.name;
  const description = updates.description ?? existing.description;
  const prompts = updates.prompts ?? existing.prompts;
  const promptsJson = JSON.stringify(prompts);

  await db().execute(`
    UPDATE prompt_profiles
    SET name = ?, description = ?, prompts_json = ?, updated_at = NOW()
    WHERE id = ?
  `, [name, description, promptsJson, id]);

  log.info({ id, name }, 'Profile updated');

  return await getProfileById(id);
}

export async function deleteProfile(id: string): Promise<boolean> {
  const profile = await getProfileById(id);

  if (!profile) return false;
  if (profile.isBuiltIn) {
    log.warn({ id }, 'Cannot delete built-in profile');
    return false;
  }

  // If deleting the active profile, switch to default
  const activeId = await getActiveProfileId();
  if (activeId === id) {
    await switchProfile('default');
  }

  const result = await db().execute(
    'DELETE FROM prompt_profiles WHERE id = ? AND is_built_in = false', [id],
  );
  if (result.changes > 0) {
    log.info({ id, name: profile.name }, 'Profile deleted');
    return true;
  }
  return false;
}

export async function duplicateProfile(sourceId: string, newName: string): Promise<PromptProfile | undefined> {
  const source = await getProfileById(sourceId);
  if (!source) return undefined;

  return await createProfile(newName, source.description, { ...source.prompts });
}

// ── Active profile ───────────────────────────────────────────────────

export async function getActiveProfileId(): Promise<string> {
  const setting = await getSetting(ACTIVE_PROFILE_KEY);
  return setting?.value || 'default';
}

export async function getActiveProfile(): Promise<PromptProfile | undefined> {
  const id = await getActiveProfileId();
  return await getProfileById(id);
}

export async function switchProfile(id: string): Promise<boolean> {
  const profile = await getProfileById(id);
  if (!profile) return false;

  // Clear per-feature prompt overrides so the new profile's prompts take effect
  for (const feature of PROMPT_FEATURES) {
    await deleteSetting(`prompts.${feature.key}.system_prompt`);
    await deleteSetting(`prompts.${feature.key}.model`);
    await deleteSetting(`prompts.${feature.key}.temperature`);
  }

  await setSetting(ACTIVE_PROFILE_KEY, id, 'prompts');
  log.info({ id, name: profile.name }, 'Switched active profile (per-feature overrides cleared)');
  return true;
}

// ── Prompt resolution from active profile ────────────────────────────

/**
 * Get the prompt config for a specific feature from the active profile.
 * Returns undefined if the active profile has no override for this feature.
 */
export async function getProfilePromptConfig(feature: PromptFeature): Promise<PromptProfileFeatureConfig | undefined> {
  const profile = await getActiveProfile();
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
