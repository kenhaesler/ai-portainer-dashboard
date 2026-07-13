/**
 * Shared OpenAI-compatible SSE stream reader.
 *
 * A single stateful parser used by every streaming LLM path (the REST/internal
 * `chatStream` in llm-client.ts and the WebSocket chat in sockets/llm-chat.ts)
 * so the transport-level parsing lives in exactly one place (#1510).
 *
 * Correctness notes (the bug this fixes):
 * - Decodes with `{ stream: true }` and carries a buffer across reads, so a
 *   `data:` line split across two `read()` chunks — common behind buffering
 *   reverse proxies or with fast coalesced token streams over plain HTTP — is
 *   reassembled instead of both halves failing JSON.parse and being dropped.
 * - Multi-byte UTF-8 characters that straddle a read boundary no longer decode
 *   to U+FFFD replacement characters.
 * - Only content up to the last newline is processed each read; the trailing
 *   partial line stays buffered until the next chunk (or the final flush).
 */

/**
 * Extract a human-readable error message from a non-streaming JSON body that
 * the OpenAI-compatible parser would otherwise drop silently.
 *
 * Servers like LM Studio (when called on the wrong path), OpenRouter, and vLLM
 * return `200 OK` with a body shaped like `{ "error": "..." }` or
 * `{ "error": { "message": "..." } }`. Without this, the streaming parser skips
 * them because they carry no `choices[0].delta.content`, yielding a silent
 * empty response.
 */
export function extractApiError(json: unknown): string | null {
  if (!json || typeof json !== 'object') return null;
  const err = (json as { error?: unknown }).error;
  if (!err) return null;
  if (typeof err === 'string') return err;
  if (typeof err === 'object' && err !== null) {
    const message = (err as { message?: unknown }).message;
    if (typeof message === 'string') return message;
    return JSON.stringify(err);
  }
  return String(err);
}

/**
 * Parse a single already-newline-delimited SSE line into a content delta.
 * Returns the content string, or `null` for lines with no content (comments,
 * the `[DONE]` sentinel, non-JSON keep-alives, or deltas that carry no text).
 * Throws when the payload is a well-formed `{ error }` body so callers surface
 * the endpoint's message instead of hanging on an empty stream.
 */
function parseSseLine(rawLine: string): string | null {
  let payload = rawLine.trim();
  if (payload === '') return null;

  // Strip the SSE "data:" prefix (OpenAI-compatible streaming format).
  if (payload.startsWith('data: ')) payload = payload.slice(6);
  else if (payload.startsWith('data:')) payload = payload.slice(5);

  // Skip the end sentinel and SSE comment lines.
  if (payload === '[DONE]' || payload.startsWith(':')) return null;

  try {
    const json = JSON.parse(payload);
    const apiError = extractApiError(json);
    if (apiError) {
      throw new Error(
        `LLM endpoint returned an error: ${apiError}. Verify Settings → AI & LLM → API Endpoint URL points at an OpenAI-compatible chat-completions endpoint.`,
      );
    }
    const content = json.choices?.[0]?.delta?.content || json.message?.content || '';
    return typeof content === 'string' && content ? content : null;
  } catch (parseErr) {
    // Re-throw API errors; swallow JSON parse errors for non-JSON SSE lines.
    if (parseErr instanceof Error && parseErr.message.startsWith('LLM endpoint returned an error')) {
      throw parseErr;
    }
    // Skip non-JSON lines (e.g. SSE event-type lines).
    return null;
  }
}

/**
 * Stream an OpenAI-compatible chat-completions response body and yield content
 * deltas as they arrive. Callers accumulate and forward each delta:
 *
 * ```ts
 * for await (const delta of streamOpenAiContent(response, { signal })) {
 *   fullResponse += delta;
 *   onChunk(delta);
 * }
 * ```
 *
 * The optional `signal` is polled before each read so a caller-side cancel
 * stops the stream promptly; the underlying fetch's own AbortSignal still
 * governs hard timeouts.
 */
export async function* streamOpenAiContent(
  response: Response,
  options: { signal?: AbortSignal } = {},
): AsyncGenerator<string, void, unknown> {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('Response body is not readable');
  }

  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      if (options.signal?.aborted) break;

      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Process only complete lines; keep the trailing partial line buffered so
      // a `data:` payload split across reads is reassembled on the next chunk.
      let newlineIndex: number;
      while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        const content = parseSseLine(line);
        if (content !== null) yield content;
      }
    }

    // Flush any bytes the decoder held for an incomplete multi-byte sequence,
    // then process a final line that arrived without a trailing newline.
    buffer += decoder.decode();
    const content = parseSseLine(buffer);
    if (content !== null) yield content;
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // Reader may already be released if the stream errored — ignore.
    }
  }
}
