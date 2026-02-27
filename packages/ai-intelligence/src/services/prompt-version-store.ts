import { getDbForDomain } from '@dashboard/core/db/app-db-router.js';
import { getSetting } from '@dashboard/core/services/settings-store.js';
import { createChildLogger } from '@dashboard/core/utils/logger.js';

const log = createChildLogger('prompt-version-store');

/** Maximum number of versions retained per feature (oldest auto-pruned; v1 is always kept). */
export const MAX_VERSIONS_PER_FEATURE = 50;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PromptVersion {
  id: number;
  feature: string;
  version: number;
  systemPrompt: string;
  model: string | null;
  temperature: number | null;
  changedBy: string;
  changedAt: string;
  changeNote: string | null;
}

interface PromptVersionRow {
  id: number;
  feature: string;
  version: number;
  system_prompt: string;
  model: string | null;
  temperature: string | null; // pg returns NUMERIC as string
  changed_by: string;
  changed_at: string;
  change_note: string | null;
}

function rowToVersion(row: PromptVersionRow): PromptVersion {
  return {
    id: row.id,
    feature: row.feature,
    version: row.version,
    systemPrompt: row.system_prompt,
    model: row.model,
    temperature: row.temperature !== null ? parseFloat(row.temperature) : null,
    changedBy: row.changed_by,
    changedAt: String(row.changed_at),
    changeNote: row.change_note,
  };
}

function db() {
  return getDbForDomain('prompts');
}

// ---------------------------------------------------------------------------
// Core operations
// ---------------------------------------------------------------------------

/**
 * Creates a new version entry for a feature's system prompt.
 * Reads the current model/temperature overrides for the feature at creation time.
 * Auto-prunes to MAX_VERSIONS_PER_FEATURE, always retaining v1.
 */
export async function createPromptVersion(
  feature: string,
  systemPrompt: string,
  changedBy: string,
  options?: { changeNote?: string },
): Promise<PromptVersion> {
  // Read the model/temperature overrides for this feature at this point in time
  const [modelSetting, tempSetting] = await Promise.all([
    getSetting(`prompts.${feature}.model`),
    getSetting(`prompts.${feature}.temperature`),
  ]);
  const model = modelSetting?.value?.trim() || null;
  const temperature = tempSetting?.value?.trim() ? parseFloat(tempSetting.value) : null;

  // Atomic version number calculation — SELECT and INSERT in one statement
  // to prevent race conditions when concurrent saves collide on the UNIQUE constraint.
  const rows = await db().query<PromptVersionRow>(
    `INSERT INTO prompt_versions (feature, version, system_prompt, model, temperature, changed_by, changed_at, change_note)
     VALUES (?, (SELECT COALESCE(MAX(version), 0) + 1 FROM prompt_versions WHERE feature = ?), ?, ?, ?, ?, NOW(), ?)
     RETURNING id, feature, version, system_prompt, model, temperature, changed_by, changed_at, change_note`,
    [feature, feature, systemPrompt, model, temperature ?? null, changedBy, options?.changeNote ?? null],
  );

  const created = rowToVersion(rows[0]);

  // Prune old versions asynchronously (do not block the response)
  pruneOldVersions(feature).catch((err) => {
    log.warn({ err, feature }, 'Failed to prune old prompt versions');
  });

  return created;
}

/**
 * Removes old versions beyond MAX_VERSIONS_PER_FEATURE.
 * Always retains version 1 (the first recorded version for this feature).
 */
async function pruneOldVersions(feature: string): Promise<void> {
  // Keep v1 + the (MAX-1) most recent other versions.
  // Delete any version > 1 that falls outside the top (MAX-1) by version number.
  await db().execute(
    `DELETE FROM prompt_versions
     WHERE feature = ?
       AND version > 1
       AND id NOT IN (
         SELECT id FROM prompt_versions
         WHERE feature = ?
           AND version > 1
         ORDER BY version DESC
         LIMIT ?
       )`,
    [feature, feature, MAX_VERSIONS_PER_FEATURE - 1],
  );
}

/**
 * Returns version history for a feature, most recent first.
 */
export async function getPromptHistory(
  feature: string,
  limit = 50,
): Promise<PromptVersion[]> {
  const rows = await db().query<PromptVersionRow>(
    `SELECT id, feature, version, system_prompt, model, temperature, changed_by, changed_at, change_note
     FROM prompt_versions
     WHERE feature = ?
     ORDER BY version DESC
     LIMIT ?`,
    [feature, limit],
  );
  return rows.map(rowToVersion);
}

/**
 * Returns a single version by its numeric id, scoped to a feature for safety.
 */
export async function getPromptVersionById(
  id: number,
  feature: string,
): Promise<PromptVersion | null> {
  const row = await db().queryOne<PromptVersionRow>(
    `SELECT id, feature, version, system_prompt, model, temperature, changed_by, changed_at, change_note
     FROM prompt_versions
     WHERE id = ? AND feature = ?`,
    [id, feature],
  );
  return row ? rowToVersion(row) : null;
}

/**
 * Returns the total count of versions for a feature.
 */
export async function getPromptVersionCount(feature: string): Promise<number> {
  const row = await db().queryOne<{ cnt: string }>(
    'SELECT COUNT(*)::integer AS cnt FROM prompt_versions WHERE feature = ?',
    [feature],
  );
  return Number(row?.cnt ?? 0);
}
