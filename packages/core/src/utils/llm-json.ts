/**
 * Extract structured JSON from an LLM response.
 *
 * LLMs return JSON in inconsistent shapes: bare JSON, JSON wrapped in a
 * ```json ... ``` markdown fence (any case for the language tag), or a fenced
 * block surrounded by explanatory prose. Historically each feature hand-rolled
 * its own regex + parse dance with subtly different behaviour, so the same
 * model output could parse in one feature and silently fail in another (#1512).
 *
 * This is the single shared extractor. It:
 *  1. trims the input,
 *  2. tries a direct `JSON.parse` (the response is bare JSON),
 *  3. falls back to the first ```json``` / ``` fenced block — tolerant of an
 *     optional `json` language tag in any case and of leading/trailing prose.
 *
 * Returns the parsed value cast to `T`, or `null` when nothing parses. Callers
 * keep their own validation/fallback for a `null` result.
 */
export function extractLlmJson<T = unknown>(raw: string): T | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // 1. Direct parse — the response is (or begins as) bare JSON.
  const direct = tryParseJson<T>(trimmed);
  if (direct !== null) return direct;

  // 2. JSON inside a markdown code fence. The optional `json` tag is matched
  //    case-insensitively and prose before/after the fence is ignored.
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) {
    const fenced = tryParseJson<T>(fenceMatch[1].trim());
    if (fenced !== null) return fenced;
  }

  return null;
}

function tryParseJson<T>(candidate: string): T | null {
  if (!candidate) return null;
  try {
    return JSON.parse(candidate) as T;
  } catch {
    return null;
  }
}
