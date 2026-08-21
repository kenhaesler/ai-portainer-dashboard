# LLM Client Gateway Efficiency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the LLM client from burdening the shared LiteLLM gateway: non-streaming requests for buffered callers, `max_tokens` on every request, and the chat socket routed through the global concurrency limiter (GitHub issue #1667).

**Architecture:** `chatStream()` in `packages/ai-intelligence/src/services/llm-client.ts` gains an optional `options?: { stream?: boolean }` parameter (default `true`, preserving current behavior). When `stream: false`, `chatStreamInner` sends a plain JSON completion request and reads `choices[0].message.content` + `usage` instead of consuming SSE. `max_tokens: llmConfig.maxTokens` is added to the request body in both modes. A new export `runWithLlmLimit` exposes the existing `pLimit(2)` gate so `streamLlmCall` in `llm-chat.ts` (which fetches directly) runs inside it. The nine buffered call sites pass `{ stream: false }`.

**Tech Stack:** TypeScript (Node 22/24), undici fetch, Vitest. No new dependencies.

**Spec:** GitHub issue #1667 (https://github.com/kenhaesler/ai-portainer-dashboard/issues/1667). No separate spec doc; the issue's "Fix Approach" section is the authority.

## Global Constraints

- Every change needs tests (repo rule 1). Mock only the HTTP boundary (`vi.mock('undici')` pattern already used in `llm-client.test.ts`); never mock pure utilities.
- Package boundaries: `ai-intelligence` imports only `@dashboard/core` and `@dashboard/contracts`. `operations`/`security`/`observability` reach the LLM only via the injected `LLMInterface`. Do not add cross-package imports.
- The prompt guard + output sanitization chokepoint in `chatStream()` must remain intact in BOTH streaming and non-streaming modes: user-role messages guarded before the request, `sanitizeLlmOutput` applied to the full response, `insertLlmTrace` recorded on success and error.
- Backward compatibility: `chatStream(messages, systemPrompt, onChunk, feature)` with no 5th argument must behave exactly as today (streaming SSE). The `LLMInterface` contract change must be optional-parameter-only.
- Run builds/tests with npm script-shell bash on Windows: `npm run build --script-shell="C:\Program Files\Git\bin\bash.exe" -w <pkg>` when a package build is needed (scripts use `cp`/`mkdir -p`).
- Commit messages: concise "why", end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Never push to `dev`/`main`; work stays on this branch.

---

### Task 1: Non-streaming mode + max_tokens + limiter export in llm-client.ts

**Files:**
- Modify: `packages/ai-intelligence/src/services/llm-client.ts` (chatStream ~line 169, chatStreamInner ~line 201, limiter block ~line 29)
- Test: `packages/ai-intelligence/src/__tests__/llm-client.test.ts`

**Interfaces:**
- Consumes: existing `llmLimit` (pLimit(2)), `getEffectiveLlmConfig` (returns `maxTokens: number`), `streamOpenAiContent`, `sanitizeLlmOutput`, `insertLlmTrace`, `estimateTokens`.
- Produces (later tasks rely on these exact shapes):
  - `export interface ChatStreamOptions { stream?: boolean }`
  - `export async function chatStream(messages: ChatMessage[], systemPrompt: string, onChunk: (chunk: string) => void, feature?: PromptFeature, options?: ChatStreamOptions): Promise<string>`
  - `export function runWithLlmLimit<T>(fn: () => Promise<T>): Promise<T>` — runs `fn` through the same `pLimit(2)` gate as `chatStream`.

- [ ] **Step 1: Write failing tests** in `llm-client.test.ts` (follow the file's existing `mockSseResponse` / `mockUndiciFetch` / `mockInsertLlmTrace` patterns; `DEFAULT_LLM_CONFIG` already carries `maxTokens: 2048`):

```typescript
function mockJsonResponse(payload: unknown) {
  mockUndiciFetch.mockResolvedValue(
    new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } }),
  );
}

describe('chatStream non-streaming mode', () => {
  it('sends stream:false and max_tokens, returns the buffered completion', async () => {
    mockJsonResponse({
      choices: [{ message: { content: 'Buffered answer' } }],
      usage: { prompt_tokens: 11, completion_tokens: 7 },
    });
    const onChunk = vi.fn();
    const result = await chatStream(
      [{ role: 'user', content: 'analyze' }], 'sys', onChunk, undefined, { stream: false },
    );
    expect(result).toBe('Buffered answer');
    expect(onChunk).not.toHaveBeenCalled();
    const body = JSON.parse(mockUndiciFetch.mock.calls[0][1].body as string);
    expect(body.stream).toBe(false);
    expect(body.max_tokens).toBe(2048);
  });

  it('records the upstream usage token counts in the trace when present', async () => {
    mockJsonResponse({
      choices: [{ message: { content: 'ok' } }],
      usage: { prompt_tokens: 11, completion_tokens: 7 },
    });
    await chatStream([{ role: 'user', content: 'q' }], 'sys', () => {}, undefined, { stream: false });
    expect(mockInsertLlmTrace).toHaveBeenCalledWith(expect.objectContaining({
      status: 'success', prompt_tokens: 11, completion_tokens: 7, total_tokens: 18,
    }));
  });

  it('falls back to estimated tokens when usage is absent', async () => {
    mockJsonResponse({ choices: [{ message: { content: 'ok' } }] });
    await chatStream([{ role: 'user', content: 'q' }], 'sys', () => {}, undefined, { stream: false });
    const trace = mockInsertLlmTrace.mock.calls[0][0];
    expect(trace.status).toBe('success');
    expect(trace.prompt_tokens).toBeGreaterThan(0);
  });

  it('sanitizes the buffered response through the central chokepoint', async () => {
    mockJsonResponse({ choices: [{ message: { content: '<think>secret</think>Visible' } }] });
    const result = await chatStream([{ role: 'user', content: 'q' }], 'sys', () => {}, undefined, { stream: false });
    expect(result).not.toContain('secret');
    expect(result).toContain('Visible');
  });

  it('throws and records an error trace on a non-OK response', async () => {
    mockUndiciFetch.mockResolvedValue(new Response('{"error":"rate limited"}', { status: 429, statusText: 'Too Many Requests' }));
    await expect(
      chatStream([{ role: 'user', content: 'q' }], 'sys', () => {}, undefined, { stream: false }),
    ).rejects.toThrow(/429/);
    expect(mockInsertLlmTrace).toHaveBeenCalledWith(expect.objectContaining({ status: 'error' }));
  });
});

describe('chatStream streaming default', () => {
  it('still sends stream:true plus max_tokens when options are omitted', async () => {
    mockSseResponse(JSON.stringify({ choices: [{ delta: { content: 'hi' } }] }) + '\n');
    await chatStream([{ role: 'user', content: 'q' }], 'sys', () => {});
    const body = JSON.parse(mockUndiciFetch.mock.calls[0][1].body as string);
    expect(body.stream).toBe(true);
    expect(body.max_tokens).toBe(2048);
  });
});

describe('runWithLlmLimit', () => {
  it('shares the pLimit(2) gate with chatStream', async () => {
    const { runWithLlmLimit } = await import('../services/llm-client.js');
    let release!: () => void;
    const blocker = new Promise<void>((r) => { release = r; });
    const a = runWithLlmLimit(() => blocker);
    const b = runWithLlmLimit(() => blocker);
    const c = runWithLlmLimit(async () => 'third');
    // Two slots busy, third queued behind them.
    expect(getLlmQueueSize()).toEqual({ pending: 1, active: 2 });
    release();
    await Promise.all([a, b, c]);
    expect(getLlmQueueSize()).toEqual({ pending: 0, active: 0 });
  });
});
```

Note: if `sanitizeLlmOutput`'s real behavior differs from the `<think>` assumption, check `prompt-guard.ts` for a pattern it strips (thinking blocks are named in its docs) and assert on that real behavior — do not mock the sanitizer.

- [ ] **Step 2: Run tests to verify the new ones fail** (`npx vitest run src/__tests__/llm-client.test.ts` from `packages/ai-intelligence/`). Expected: new tests fail (options param ignored / `max_tokens` absent / `runWithLlmLimit` not exported), existing 58 pass.

- [ ] **Step 3: Implement.** In `llm-client.ts`:

1. Below `getLlmQueueSize`, add:

```typescript
/**
 * Run an arbitrary LLM-bound operation through the same global concurrency
 * gate as chatStream. Exists for callers that manage their own request
 * lifecycle (the chat socket's tool loop) so interactive traffic cannot
 * exceed the gateway budget the limiter exists to enforce (#1667).
 */
export function runWithLlmLimit<T>(fn: () => Promise<T>): Promise<T> {
  return llmLimit(fn);
}
```

2. Add the options type and thread it through:

```typescript
/** Options for chatStream. `stream` defaults to true (SSE). Buffered callers
 *  that never consume chunks pass { stream: false } so the gateway can hand
 *  off a single JSON completion instead of holding a streaming slot (#1667). */
export interface ChatStreamOptions {
  stream?: boolean;
}
```

`chatStream(messages, systemPrompt, onChunk, feature?, options?)` passes `options` to `chatStreamInner(messages, systemPrompt, onChunk, feature, options)`. Guard logic unchanged.

3. In `chatStreamInner`, compute `const streaming = options?.stream !== false;` and build the body once:

```typescript
      body: JSON.stringify({
        model: llmConfig.model,
        messages: fullMessages,
        stream: streaming,
        ...(llmConfig.maxTokens ? { max_tokens: llmConfig.maxTokens } : {}),
        ...(llmConfig.temperature !== undefined ? { temperature: llmConfig.temperature } : {}),
      }),
```

4. After the `response.ok` check, branch. Streaming path is byte-for-byte the existing `for await (streamOpenAiContent(...))` loop. Non-streaming path:

```typescript
    let usagePromptTokens: number | undefined;
    let usageCompletionTokens: number | undefined;
    if (streaming) {
      for await (const content of streamOpenAiContent(response)) {
        fullResponse += content;
        onChunk(content);
      }
    } else {
      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      fullResponse = data.choices?.[0]?.message?.content ?? '';
      if (typeof data.usage?.prompt_tokens === 'number') usagePromptTokens = data.usage.prompt_tokens;
      if (typeof data.usage?.completion_tokens === 'number') usageCompletionTokens = data.usage.completion_tokens;
    }
```

5. Token accounting for the success trace prefers upstream usage:

```typescript
    const promptTokens = usagePromptTokens ?? estimateTokens(fullMessages.map((m) => m.content).join(''));
    const completionTokens = usageCompletionTokens ?? estimateTokens(fullResponse);
```

Everything downstream (sanitize, trace insert, debug log, error path) is unchanged.

- [ ] **Step 4: Run the full file** (`npx vitest run src/__tests__/llm-client.test.ts`). Expected: all pass.

- [ ] **Step 5: Commit** (`git add` the two files; message: `feat: non-streaming LLM completions, max_tokens cap, shared limiter export (#1667)`).

---

### Task 2: Contract + chat socket through the limiter

**Files:**
- Modify: `packages/contracts/src/interfaces/llm-interface.ts` (chatStream declaration ~line 40)
- Modify: `packages/ai-intelligence/src/sockets/llm-chat.ts` (`streamLlmCall`, ~lines 427-497)
- Test: `packages/ai-intelligence/src/__tests__/llm-chat.test.ts` (needs the test PostgreSQL on port 5433)

**Interfaces:**
- Consumes: `runWithLlmLimit` and `ChatStreamOptions` from Task 1 (`../services/llm-client.js`).
- Produces: `LLMInterface.chatStream(messages, systemPrompt, onChunk, feature?, options?: { stream?: boolean }): Promise<string>` — optional 5th parameter, structurally identical to `ChatStreamOptions` (declare the object literal type inline in the contract; contracts must not import from ai-intelligence).

- [ ] **Step 1: Update the contract.** Add to `LLMInterface.chatStream` after `feature?: string`:

```typescript
    options?: {
      /**
       * Default true (SSE streaming). Buffered callers that pass a no-op
       * onChunk set false so the gateway serves one JSON completion instead
       * of holding a streaming slot for the whole generation (#1667).
       */
      stream?: boolean;
    },
```

- [ ] **Step 2: Write a failing test** in `llm-chat.test.ts` following that file's existing socket/fetch mock harness: while a `chat:message` LLM call is in flight (fetch mock blocked on an unresolved promise), `getLlmQueueSize().active` is ≥ 1; after saturating the limiter with two blocked `runWithLlmLimit` tasks first, the chat-triggered call must be `pending`, not `active`. If the file's harness makes the blocked-stream shape impractical, an acceptable alternative is asserting `getLlmQueueSize()` transitions around a completed chat flow (active returns to 0, and a spy on the fetch shows it ran while the queue registered the call). Import `getLlmQueueSize`/`runWithLlmLimit` from `../services/llm-client.js`.

- [ ] **Step 3: Run it to verify it fails** (`npx vitest run src/__tests__/llm-chat.test.ts`). Requires Docker test DB on 5433.

- [ ] **Step 4: Implement.** In `llm-chat.ts`, import `runWithLlmLimit` from `../services/llm-client.js` and wrap the entire existing body of `streamLlmCall` (from the `if (!llmConfig.apiUrl)` guard through `return fullResponse;`) in:

```typescript
  return runWithLlmLimit(async () => {
    // ...existing body unchanged...
  });
```

Keep the `if (!llmConfig.apiUrl) throw` guard OUTSIDE the wrapper (matching `chatStream`, whose prompt guard also throws before the limiter), and wrap everything after it.

- [ ] **Step 5: Run the tests** (`npx vitest run src/__tests__/llm-chat.test.ts`). Expected: PASS.

- [ ] **Step 6: Build contracts** (`npm run build --script-shell="C:\Program Files\Git\bin\bash.exe" -w packages/contracts` from repo root) so dependent-package tests resolve the new signature, then commit both files (`feat: route chat socket LLM calls through the global concurrency limiter (#1667)`).

---

### Task 3: Buffered call sites opt out of streaming + docs

**Files:**
- Modify (append `, { stream: false }` as the 5th argument to the named `chatStream` call, keeping the existing 4th argument if present, else passing `undefined` for it):
  - `packages/ai-intelligence/src/services/anomaly-explainer.ts` (two calls, ~lines 34, 132)
  - `packages/ai-intelligence/src/services/incident-summarizer.ts` (~line 28)
  - `packages/ai-intelligence/src/services/investigation-service.ts` (~line 399)
  - `packages/ai-intelligence/src/services/log-analyzer.ts` (~line 39)
  - `packages/ai-intelligence/src/services/monitoring-service.ts` (~line 680)
  - `packages/ai-intelligence/src/routes/correlations.ts` (~line 581)
  - `packages/operations/src/services/remediation-service.ts` (two calls, ~lines 336, 348 — via `_llm!.chatStream`)
  - `packages/security/src/services/pcap-analysis-service.ts` (~line 320 — via `llm.chatStream`)
  - `packages/observability/src/routes/forecasts.ts` (~line 207 — via `opts.llm.chatStream`)
- Do NOT touch: `packages/observability/src/routes/metrics.ts` ai-summary (real streaming consumer) or anything in `llm-chat.ts`.
- Test: extend ONE existing test per changed package to assert the spy received `{ stream: false }`:
  - `packages/ai-intelligence/src/__tests__/anomaly-explainer.test.ts`
  - `packages/operations/src/__tests__/remediation-service.test.ts`
  - `packages/security/src/__tests__/pcap-route.test.ts`
  - `packages/observability/src/__tests__/forecasts-route.test.ts`
- Modify docs: `docs/architecture.md`, `CLAUDE.md`, `packages/ai-intelligence/src/CLAUDE.md`

**Interfaces:**
- Consumes: `ChatStreamOptions` / contract options param from Tasks 1-2.
- Produces: nothing new.

Transformation pattern (example, anomaly-explainer):

```typescript
// before
const response = await chatStream(
  [{ role: 'user', content: userPrompt }],
  await getEffectivePrompt('anomaly_explainer'),
  () => {},
  'anomaly_explainer',
);
// after
const response = await chatStream(
  [{ role: 'user', content: userPrompt }],
  await getEffectivePrompt('anomaly_explainer'),
  () => {},
  'anomaly_explainer',
  { stream: false },
);
```

If a call currently has no 4th argument, pass `undefined` for `feature`: `chatStream(msgs, sys, () => {}, undefined, { stream: false })`.

- [ ] **Step 1: Extend the four named tests** to assert the existing chatStream mock/spy was called with a final argument `expect.objectContaining({ stream: false })` (follow each file's existing mock — most use a hand-rolled `LLMInterface` double or `vi.mock` of llm-client). Run them; the new assertions must fail.

- [ ] **Step 2: Apply the call-site edits** to all ten listed calls.

- [ ] **Step 3: Run the touched packages' relevant tests**, e.g. from each package dir: `npx vitest run src/__tests__/anomaly-explainer.test.ts`, `src/__tests__/remediation-service.test.ts`, `src/__tests__/pcap-route.test.ts`, `src/__tests__/forecasts-route.test.ts`. Expected: PASS. (Some of these need the test DB on 5433.)

- [ ] **Step 4: Docs.**
  - `docs/architecture.md`: in the LLM/AI section, add a short paragraph titled "LLM gateway efficiency (#1667)" stating: buffered internal flows request non-streaming completions (`{ stream: false }`), every request carries `max_tokens` from the effective config, upstream `usage` token counts are preferred over local estimates in `llm_traces`, and the chat socket's direct calls run inside the same global `pLimit(2)` gate via `runWithLlmLimit`.
  - Root `CLAUDE.md`, Security rule 3 (LLM safety): append one sentence: "Buffered internal callers pass `{ stream: false }` so the shared gateway is not held on SSE slots nobody consumes; only true live-stream consumers (chat socket, metrics ai-summary SSE) stream, and the chat socket's direct calls go through `runWithLlmLimit` (#1667)."
  - `packages/ai-intelligence/src/CLAUDE.md`, Key Rules: same one-sentence rule.

- [ ] **Step 5: Typecheck the touched packages** from repo root: `npm run typecheck -w packages/ai-intelligence -w packages/operations -w packages/security -w packages/observability -w packages/contracts` (script-shell not needed for tsc). Expected: clean.

- [ ] **Step 6: Commit** (`feat: buffered LLM callers opt out of streaming (#1667)` — include doc updates).
