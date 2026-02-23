/**
 * Test helper — checks Ollama connectivity for LLM integration tests.
 */

/**
 * Check if Ollama is reachable at the configured URL.
 */
export async function isOllamaAvailable(): Promise<boolean> {
  try {
    const url = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434';
    const res = await fetch(`${url}/api/tags`);
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Get list of available models on the Ollama instance.
 */
export async function getAvailableModels(): Promise<string[]> {
  const url = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434';
  const res = await fetch(`${url}/api/tags`);
  if (!res.ok) return [];
  const data = (await res.json()) as { models?: Array<{ name: string }> };
  return (data.models ?? []).map((m) => m.name);
}
