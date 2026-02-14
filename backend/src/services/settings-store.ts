import { getDbForDomain } from '../db/app-db-router.js';
import { getConfig } from '../config/index.js';
import { createChildLogger } from '../utils/logger.js';
import type { Setting } from '../models/settings.js';

const log = createChildLogger('settings-store');

function db() {
  return getDbForDomain('settings');
}

export async function getSetting(key: string): Promise<Setting | null> {
  return db().queryOne<Setting>('SELECT * FROM settings WHERE key = ?', [key]);
}

export async function setSetting(key: string, value: string, category: string): Promise<void> {
  await db().execute(`
    INSERT INTO settings (key, value, category, updated_at)
    VALUES (?, ?, ?, NOW())
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      category = excluded.category,
      updated_at = NOW()
  `, [key, value, category]);

  log.debug({ key, category }, 'Setting saved');
}

export async function getSettings(category?: string): Promise<Setting[]> {
  if (category) {
    return db().query<Setting>('SELECT * FROM settings WHERE category = ? ORDER BY key ASC', [category]);
  }

  return db().query<Setting>('SELECT * FROM settings ORDER BY category ASC, key ASC');
}

/**
 * Read LLM config from the settings DB, falling back to env vars.
 * Called per-request so that Settings page changes take effect immediately.
 */
export async function getEffectiveLlmConfig() {
  const config = getConfig();
  const ollamaUrl = (await getSetting('llm.ollama_url'))?.value || config.OLLAMA_BASE_URL;
  const model = (await getSetting('llm.model'))?.value || config.OLLAMA_MODEL;
  const customEndpointUrl = (await getSetting('llm.custom_endpoint_url'))?.value || config.LLM_OPENAI_ENDPOINT;
  // Custom mode: enabled via Settings UI toggle OR when LLM_OPENAI_ENDPOINT env var is set.
  // When disabled, the Ollama SDK is used for native Ollama access.
  const customEnabled = (await getSetting('llm.custom_endpoint_enabled'))?.value === 'true' || !!config.LLM_OPENAI_ENDPOINT;
  const customEndpointToken = (await getSetting('llm.custom_endpoint_token'))?.value || config.LLM_BEARER_TOKEN;
  const authType = ((await getSetting('llm.auth_type'))?.value as 'bearer' | 'basic') || config.LLM_AUTH_TYPE;
  const maxTokens = parseInt((await getSetting('llm.max_tokens'))?.value || '20000', 10) || 20000;
  const maxToolIterations = parseInt((await getSetting('llm.max_tool_iterations'))?.value || '', 10) || config.LLM_MAX_TOOL_ITERATIONS;
  return { ollamaUrl, model, customEnabled, customEndpointUrl, customEndpointToken, authType, maxTokens, maxToolIterations };
}

/**
 * Read MCP config from the settings DB, falling back to env vars.
 * Called per-request so that Settings page changes take effect immediately.
 */
export async function getEffectiveMcpConfig() {
  const config = getConfig();
  const toolTimeout = parseInt((await getSetting('mcp.tool_timeout'))?.value || '', 10) || config.MCP_TOOL_TIMEOUT;
  return { toolTimeout };
}

export async function deleteSetting(key: string): Promise<boolean> {
  const result = await db().execute('DELETE FROM settings WHERE key = ?', [key]);

  if (result.changes > 0) {
    log.info({ key }, 'Setting deleted');
    return true;
  }
  return false;
}
