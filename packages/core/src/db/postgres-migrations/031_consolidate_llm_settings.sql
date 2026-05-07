-- Consolidate LLM integration settings: drop the dual Ollama/Custom-API
-- distinction and standardize on a single OpenAI-compatible API config.
--
-- - llm.custom_endpoint_url   -> llm.api_url
-- - llm.custom_endpoint_token -> llm.api_token
-- - llm.ollama_url            -> deleted (no longer applicable)
-- - llm.custom_endpoint_enabled -> deleted (no longer a toggle)

-- Copy old keys to new keys (no-op if new key already exists)
INSERT INTO settings (key, value, category, updated_at)
SELECT 'llm.api_url', value, category, NOW()
  FROM settings
 WHERE key = 'llm.custom_endpoint_url'
ON CONFLICT (key) DO NOTHING;

INSERT INTO settings (key, value, category, updated_at)
SELECT 'llm.api_token', value, category, NOW()
  FROM settings
 WHERE key = 'llm.custom_endpoint_token'
ON CONFLICT (key) DO NOTHING;

-- Remove obsolete keys
DELETE FROM settings
 WHERE key IN (
   'llm.ollama_url',
   'llm.custom_endpoint_enabled',
   'llm.custom_endpoint_url',
   'llm.custom_endpoint_token'
 );
