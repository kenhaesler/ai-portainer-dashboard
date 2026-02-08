import { getDb } from '../db/sqlite.js';
import { getConfig } from '../config/index.js';
import { createChildLogger } from '../utils/logger.js';
import type { Setting } from '../models/settings.js';

const log = createChildLogger('settings-store');

export function getSetting(key: string): Setting | undefined {
  const db = getDb();
  return db
    .prepare('SELECT * FROM settings WHERE key = ?')
    .get(key) as Setting | undefined;
}

export function setSetting(key: string, value: string, category: string): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO settings (key, value, category, updated_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      category = excluded.category,
      updated_at = datetime('now')
  `).run(key, value, category);

  log.debug({ key, category }, 'Setting saved');
}

export function getSettings(category?: string): Setting[] {
  const db = getDb();

  if (category) {
    return db
      .prepare('SELECT * FROM settings WHERE category = ? ORDER BY key ASC')
      .all(category) as Setting[];
  }

  return db
    .prepare('SELECT * FROM settings ORDER BY category ASC, key ASC')
    .all() as Setting[];
}

/**
 * Read LLM config from the settings DB, falling back to env vars.
 * Called per-request so that Settings page changes take effect immediately.
 */
export function getEffectiveLlmConfig() {
  const config = getConfig();
  const ollamaUrl = getSetting('llm.ollama_url')?.value || config.OLLAMA_BASE_URL;
  const model = getSetting('llm.model')?.value || config.OLLAMA_MODEL;
  const customEnabled = getSetting('llm.custom_endpoint_enabled')?.value === 'true';
  const customEndpointUrl = getSetting('llm.custom_endpoint_url')?.value || config.OLLAMA_API_ENDPOINT;
  const customEndpointToken = getSetting('llm.custom_endpoint_token')?.value || config.OLLAMA_BEARER_TOKEN;
  const maxTokens = parseInt(getSetting('llm.max_tokens')?.value || '20000', 10) || 20000;
  return { ollamaUrl, model, customEnabled, customEndpointUrl, customEndpointToken, maxTokens };
}

/**
 * Read MCP config from the settings DB, falling back to env vars.
 * Called per-request so that Settings page changes take effect immediately.
 */
export function getEffectiveMcpConfig() {
  const config = getConfig();
  const toolTimeout = parseInt(getSetting('mcp.tool_timeout')?.value || '', 10) || config.MCP_TOOL_TIMEOUT;
  return { toolTimeout };
}

export function deleteSetting(key: string): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM settings WHERE key = ?').run(key);

  if (result.changes > 0) {
    log.info({ key }, 'Setting deleted');
    return true;
  }
  return false;
}
