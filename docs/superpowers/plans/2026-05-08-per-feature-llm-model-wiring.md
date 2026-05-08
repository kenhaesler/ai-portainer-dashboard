# Per-Feature LLM Model Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire every LLM consumer through the existing feature-aware `getEffectiveLlmConfig(feature)` resolver so per-feature model and temperature overrides configured in Prompt Profiles actually take effect at runtime.

**Architecture:** Single-PR refactor. Switch the resolver import in `chatStream` (the funnel for ~12 of ~15 inference sites) to the feature-aware variant in `prompt-store.ts`, add an optional `feature` parameter, and update each call site to pass its feature key. Update the `LLMInterface` contract so cross-domain consumers (security, observability, operations) can pass through DI. Spread `temperature` into request bodies when the resolver returns one.

**Tech Stack:** TypeScript, Vitest, Fastify 5, OpenAI-compatible chat-completions API. No new dependencies. No DB migration. No UI changes.

**Spec:** `docs/superpowers/specs/2026-05-08-per-feature-llm-model-wiring-design.md`

---

## File Structure

**Modified files (12):**

- `packages/ai-intelligence/src/services/llm-client.ts` — add `feature` param to `chatStream`/`chatStreamInner`, switch resolver, spread temperature.
- `packages/contracts/src/interfaces/llm-interface.ts` — add optional `feature` param to `chatStream`.
- `packages/ai-intelligence/src/sockets/llm-chat.ts` — direct fetch site; switch resolver, pass `chat_assistant`, spread temperature.
- `packages/ai-intelligence/src/routes/llm.ts` — direct fetch sites; switch resolver for AI search (`command_palette`) and test-prompt (use request `feature`); spread temperature where applicable.
- `packages/ai-intelligence/src/routes/correlations.ts` — pass `correlation_insights` to `chatStream`.
- `packages/ai-intelligence/src/services/log-analyzer.ts` — pass `log_analyzer`.
- `packages/ai-intelligence/src/services/monitoring-service.ts` — pass `monitoring_analysis`.
- `packages/ai-intelligence/src/services/anomaly-explainer.ts` — pass `anomaly_explainer` (two call sites).
- `packages/ai-intelligence/src/services/incident-summarizer.ts` — pass `incident_summarizer`.
- `packages/ai-intelligence/src/services/investigation-service.ts` — pass `root_cause`.
- `packages/security/src/services/pcap-analysis-service.ts` — pass `pcap_analyzer`.
- `packages/observability/src/routes/forecasts.ts` — pass `capacity_forecast`.
- `packages/observability/src/routes/metrics.ts` — pass `metrics_summary`.
- `packages/operations/src/services/remediation-service.ts` — pass `remediation` (two call sites).

**New test:**

- `packages/ai-intelligence/src/__tests__/anomaly-explainer.test.ts` — extend with a profile-driven model test (or add a new test file `__tests__/per-feature-model-wiring.test.ts` if cleaner).

**No deletions. No new production source files.**

The `feature` parameter type is `string` in the contract (matching the existing `getEffectivePrompt(domain: string)` precedent). Inside ai-intelligence, callers use the typed `PromptFeature` union. The feature-aware resolver in `prompt-store.ts` already accepts `PromptFeature | undefined`; callers from outside the package pass narrower string literals, validated by the resolver's ignore-unknown-feature behavior (a setting key like `prompts.<unknown>.model` simply doesn't exist, falling back to global).

---

## Sanity Check Before Starting

- [ ] **Step 0a: Confirm branch is `dev` (current state)**

The brainstorming session left a doc commit on `dev`. The user opted to leave it. New work continues on `dev` per their instruction.

Run: `git status && git log --oneline -3`
Expected: clean tree (or only untracked plan files), HEAD = `9ceddccc docs(spec): per-feature LLM model wiring fix`.

- [ ] **Step 0b: Confirm baseline tests pass**

Run: `cd packages/ai-intelligence && npx vitest run src/__tests__/prompt-store.test.ts`
Expected: PASS — the resolver itself is correct; the bug is only that consumers don't call it.

---

## Task 1: Add Failing Test for Per-Feature Model Wiring

This is the diagnostic test. It must FAIL on current `dev`, proving the bug. It must PASS after Task 3.

**Files:**
- Create: `packages/ai-intelligence/src/__tests__/per-feature-model-wiring.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/ai-intelligence/src/__tests__/per-feature-model-wiring.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mocks must be hoisted before importing the module under test.
const mockGetEffectiveLlmConfigPromptStore = vi.fn();
const mockGetEffectiveLlmConfigGlobal = vi.fn();
const mockGetEffectivePrompt = vi.fn();
const mockInsertLlmTrace = vi.fn().mockResolvedValue(undefined);
const mockLlmFetch = vi.fn();

vi.mock('../services/prompt-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/prompt-store.js')>();
  return {
    ...actual,
    getEffectiveLlmConfig: mockGetEffectiveLlmConfigPromptStore,
    getEffectivePrompt: mockGetEffectivePrompt,
  };
});

vi.mock('@dashboard/core/services/settings-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@dashboard/core/services/settings-store.js')>();
  return {
    ...actual,
    getEffectiveLlmConfig: mockGetEffectiveLlmConfigGlobal,
  };
});

vi.mock('../services/llm-trace-store.js', () => ({
  insertLlmTrace: mockInsertLlmTrace,
}));

// Mock fetch wrapper used internally by chatStream (llmFetch lives in llm-client itself,
// so we mock global fetch instead — simpler).
beforeEach(() => {
  vi.clearAllMocks();
  mockGetEffectivePrompt.mockResolvedValue('test prompt');
  mockInsertLlmTrace.mockResolvedValue(undefined);

  // Stub fetch with a minimal SSE response that emits one delta then [DONE].
  globalThis.fetch = vi.fn().mockResolvedValue(
    new Response(
      'data: {"choices":[{"delta":{"content":"hello"}}]}\n\ndata: [DONE]\n\n',
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    ),
  ) as unknown as typeof fetch;
});

describe('chatStream — per-feature model resolution', () => {
  it('uses the feature-aware resolver when a feature key is passed', async () => {
    mockGetEffectiveLlmConfigPromptStore.mockResolvedValue({
      apiUrl: 'http://localhost:9999',
      apiToken: 'tok',
      model: 'feature-specific-model',
      authType: 'bearer',
      maxTokens: 1000,
      maxToolIterations: 5,
    });

    const { chatStream } = await import('../services/llm-client.js');

    await chatStream(
      [{ role: 'user', content: 'hi' }],
      'system',
      () => {},
      'anomaly_explainer',
    );

    expect(mockGetEffectiveLlmConfigPromptStore).toHaveBeenCalledWith('anomaly_explainer');

    // Verify the request body sent to the LLM uses the feature-specific model.
    const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(fetchCall[1].body as string);
    expect(body.model).toBe('feature-specific-model');
  });

  it('includes temperature in the request body when the resolver returns one', async () => {
    mockGetEffectiveLlmConfigPromptStore.mockResolvedValue({
      apiUrl: 'http://localhost:9999',
      apiToken: 'tok',
      model: 'm',
      authType: 'bearer',
      maxTokens: 1000,
      maxToolIterations: 5,
      temperature: 0.2,
    });

    const { chatStream } = await import('../services/llm-client.js');

    await chatStream(
      [{ role: 'user', content: 'hi' }],
      'system',
      () => {},
      'log_analyzer',
    );

    const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(fetchCall[1].body as string);
    expect(body.temperature).toBe(0.2);
  });

  it('omits temperature when the resolver does not return one', async () => {
    mockGetEffectiveLlmConfigPromptStore.mockResolvedValue({
      apiUrl: 'http://localhost:9999',
      apiToken: 'tok',
      model: 'm',
      authType: 'bearer',
      maxTokens: 1000,
      maxToolIterations: 5,
    });

    const { chatStream } = await import('../services/llm-client.js');

    await chatStream(
      [{ role: 'user', content: 'hi' }],
      'system',
      () => {},
    );

    const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(fetchCall[1].body as string);
    expect(body.temperature).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/ai-intelligence && npx vitest run src/__tests__/per-feature-model-wiring.test.ts`

Expected: FAIL on the first test — `chatStream` only accepts 3 args, the 4th `feature` is unused, and it currently calls the global resolver. Either a TypeScript error on the 4-arg call, or `mockGetEffectiveLlmConfigPromptStore` is never called.

- [ ] **Step 3: Commit the failing test**

```bash
git add packages/ai-intelligence/src/__tests__/per-feature-model-wiring.test.ts
git commit -m "test(llm): add failing test for per-feature model wiring"
```

---

## Task 2: Update `LLMInterface` Contract

**Files:**
- Modify: `packages/contracts/src/interfaces/llm-interface.ts`

- [ ] **Step 1: Add optional `feature` to `chatStream`**

Current contract (lines 14-22):

```ts
export interface LLMInterface {
  isAvailable(): Promise<boolean>;
  chatStream(
    messages: ChatMessage[],
    systemPrompt: string,
    onChunk: (chunk: string) => void,
  ): Promise<string>;
  buildInfrastructureContext(
    endpoints: NormalizedEndpoint[],
    containers: NormalizedContainer[],
    insights: Insight[],
  ): string;
  /** Retrieve the effective system prompt for a named domain (e.g. 'pcap_analyzer'). */
  getEffectivePrompt(domain: string): Promise<string>;
}
```

Replace `chatStream` signature with:

```ts
  /**
   * Stream an LLM chat completion. Pass `feature` (e.g. 'pcap_analyzer',
   * 'capacity_forecast') so per-feature model and temperature overrides
   * from the active prompt profile take effect.
   */
  chatStream(
    messages: ChatMessage[],
    systemPrompt: string,
    onChunk: (chunk: string) => void,
    feature?: string,
  ): Promise<string>;
```

- [ ] **Step 2: Verify the contracts package builds**

Run: `npm run build -w @dashboard/contracts`
Expected: success.

- [ ] **Step 3: Commit**

```bash
git add packages/contracts/src/interfaces/llm-interface.ts
git commit -m "feat(contracts): add optional feature param to LLMInterface.chatStream"
```

---

## Task 3: Implement Feature-Aware `chatStream`

This makes the failing test from Task 1 pass.

**Files:**
- Modify: `packages/ai-intelligence/src/services/llm-client.ts`

- [ ] **Step 1: Switch resolver import and add `PromptFeature` type import**

Current imports (line ~7):

```ts
import { getEffectiveLlmConfig } from '@dashboard/core/services/settings-store.js';
```

Replace with:

```ts
import { getEffectiveLlmConfig, type PromptFeature } from './prompt-store.js';
```

The feature-aware resolver returns the same shape as the global resolver, plus an optional `temperature?: number`. It calls the global resolver internally as a fallback, so behavior with `feature === undefined` is identical to today.

- [ ] **Step 2: Add `feature` parameter to `chatStream` and `chatStreamInner`**

Current `chatStream` (lines ~191-201):

```ts
export async function chatStream(
  messages: ChatMessage[],
  systemPrompt: string,
  onChunk: (chunk: string) => void,
): Promise<string> {
  return llmLimit(() =>
    withSpan('LLM chat', 'llm-service', 'client', () =>
      chatStreamInner(messages, systemPrompt, onChunk),
    ),
  );
}
```

Replace with:

```ts
export async function chatStream(
  messages: ChatMessage[],
  systemPrompt: string,
  onChunk: (chunk: string) => void,
  feature?: PromptFeature,
): Promise<string> {
  return llmLimit(() =>
    withSpan('LLM chat', 'llm-service', 'client', () =>
      chatStreamInner(messages, systemPrompt, onChunk, feature),
    ),
  );
}
```

Current `chatStreamInner` signature (lines ~203-208):

```ts
async function chatStreamInner(
  messages: ChatMessage[],
  systemPrompt: string,
  onChunk: (chunk: string) => void,
): Promise<string> {
  const llmConfig = await getEffectiveLlmConfig();
```

Replace with:

```ts
async function chatStreamInner(
  messages: ChatMessage[],
  systemPrompt: string,
  onChunk: (chunk: string) => void,
  feature?: PromptFeature,
): Promise<string> {
  const llmConfig = await getEffectiveLlmConfig(feature);
```

- [ ] **Step 3: Spread temperature into request body**

Current request body (around line 239):

```ts
      body: JSON.stringify({
        model: llmConfig.model,
        messages: fullMessages,
        stream: true,
      }),
```

Replace with:

```ts
      body: JSON.stringify({
        model: llmConfig.model,
        messages: fullMessages,
        stream: true,
        ...(typeof (llmConfig as { temperature?: number }).temperature === 'number'
          ? { temperature: (llmConfig as { temperature?: number }).temperature }
          : {}),
      }),
```

(The cast is needed because the global resolver shape doesn't declare `temperature` but the feature-aware one optionally adds it.)

- [ ] **Step 4: Run the failing test from Task 1 to verify it now passes**

Run: `cd packages/ai-intelligence && npx vitest run src/__tests__/per-feature-model-wiring.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Run the full ai-intelligence test suite to catch regressions**

Run: `cd packages/ai-intelligence && npx vitest run`
Expected: PASS. If `llm-client.test.ts` or any consumer-test mocks `chatStream` with the old 3-arg signature, the test still passes because `feature` is optional. Investigate any new failures before proceeding.

- [ ] **Step 6: Commit**

```bash
git add packages/ai-intelligence/src/services/llm-client.ts
git commit -m "fix(llm): wire chatStream through feature-aware resolver"
```

---

## Task 4: Update Direct Fetch Sites in ai-intelligence

These two call sites build their own request bodies and don't go through `chatStream`. They need separate edits.

**Files:**
- Modify: `packages/ai-intelligence/src/sockets/llm-chat.ts`
- Modify: `packages/ai-intelligence/src/routes/llm.ts`

### Step group A: `sockets/llm-chat.ts` — chat socket handler

- [ ] **Step 1: Switch resolver import**

Current import (line ~6):

```ts
import { getEffectiveLlmConfig } from '@dashboard/core/services/settings-store.js';
```

Replace with:

```ts
import { getEffectiveLlmConfig } from '../services/prompt-store.js';
```

- [ ] **Step 2: Pass feature key at call site**

Current line ~605:

```ts
      const llmConfig = await getEffectiveLlmConfig();
      const selectedModel = data.model || llmConfig.model;
```

Replace with:

```ts
      const llmConfig = await getEffectiveLlmConfig('chat_assistant');
      const selectedModel = data.model || llmConfig.model;
```

- [ ] **Step 3: Spread temperature into the chat completion request body in this file**

Search for the `JSON.stringify({ model: selectedModel, messages: ..., stream: true` pattern in `llm-chat.ts` (it's a few lines below the `selectedModel` resolution). Add the same conditional `temperature` spread used in Task 3 Step 3:

```ts
        ...(typeof (llmConfig as { temperature?: number }).temperature === 'number'
          ? { temperature: (llmConfig as { temperature?: number }).temperature }
          : {}),
```

If the user explicitly supplies a temperature in the socket payload (`data.temperature`), that wins over `llmConfig.temperature`. Inspect the file to confirm whether `data.temperature` exists; if it does, prefer it: `temperature: data.temperature ?? llmConfig.temperature` (only spread when defined).

### Step group B: `routes/llm.ts` — AI search and test-prompt

- [ ] **Step 4: Switch resolver import in `routes/llm.ts`**

Current import (line ~13):

```ts
import { getEffectiveLlmConfig } from '@dashboard/core/services/settings-store.js';
```

Replace with:

```ts
import { getEffectiveLlmConfig } from '../services/prompt-store.js';
import type { PromptFeature } from '../services/prompt-store.js';
```

(`PROMPT_FEATURES` and `PromptFeature` are already imported a few lines later — consolidate imports as needed; do not duplicate.)

- [ ] **Step 5: AI search route (line ~92) — pass `command_palette`**

Current:

```ts
    const llmConfig = await getEffectiveLlmConfig();
    const { query } = request.body;
    const startTime = Date.now();

    const searchModel = llmConfig.model;
```

Replace with:

```ts
    const llmConfig = await getEffectiveLlmConfig('command_palette');
    const { query } = request.body;
    const startTime = Date.now();

    const searchModel = llmConfig.model;
```

Then in the request body construction (around line 130), add the temperature spread:

```ts
        body: JSON.stringify({
          model: searchModel,
          messages,
          stream: false,
          response_format: { type: 'json_object' },
          ...(typeof (llmConfig as { temperature?: number }).temperature === 'number'
            ? { temperature: (llmConfig as { temperature?: number }).temperature }
            : {}),
        }),
```

- [ ] **Step 6: Test-prompt route (line ~301) — pass the request's `feature`**

Current:

```ts
    const llmConfig = await getEffectiveLlmConfig();
    const effectiveModel = model && model.trim() ? model.trim() : llmConfig.model;
```

Replace with:

```ts
    const llmConfig = await getEffectiveLlmConfig(feature as PromptFeature);
    const effectiveModel = model && model.trim() ? model.trim() : llmConfig.model;
```

The `feature` variable is already extracted from the request body and validated against `PROMPT_FEATURES` earlier in the handler, so the cast is safe.

The test-prompt request body already supports `temperature` from the request directly (line ~325: `...(temperature !== undefined ? { temperature } : {})`). Leave that as-is — explicit user input from the test UI takes precedence over profile config; this matches the existing behavior where the user is testing a specific override.

- [ ] **Step 7: Test-connection route (line ~245) — leave unchanged**

This route only lists models; it does not run inference. The global resolver remains correct here. No edit needed but the import line was already changed in Step 4 — verify the file still compiles.

- [ ] **Step 8: Models list route (line ~421) — leave unchanged**

Same reason as Step 7.

- [ ] **Step 9: Run ai-intelligence tests**

Run: `cd packages/ai-intelligence && npx vitest run`
Expected: PASS. Pay attention to `llm-chat.test.ts` and `llm.test.ts`.

- [ ] **Step 10: Commit**

```bash
git add packages/ai-intelligence/src/sockets/llm-chat.ts packages/ai-intelligence/src/routes/llm.ts
git commit -m "fix(llm): wire chat socket and AI search through feature-aware resolver"
```

---

## Task 5: Pass Feature Keys at `chatStream` Call Sites in ai-intelligence

Each call site adds the feature key as a 4th argument.

**Files:**
- Modify: `packages/ai-intelligence/src/routes/correlations.ts:312`
- Modify: `packages/ai-intelligence/src/services/log-analyzer.ts:37`
- Modify: `packages/ai-intelligence/src/services/monitoring-service.ts:621`
- Modify: `packages/ai-intelligence/src/services/anomaly-explainer.ts:33` and `:131`
- Modify: `packages/ai-intelligence/src/services/incident-summarizer.ts:29`
- Modify: `packages/ai-intelligence/src/services/investigation-service.ts:398`

For each call, add the feature key as the 4th argument to the existing `chatStream(...)` call. Examples:

- [ ] **Step 1: `correlations.ts:312`**

Find:
```ts
      const response = await chatStream(
        messages,
        await getEffectivePrompt('correlation_insights'),
        onChunk,
      );
```

Add `'correlation_insights'` as 4th argument:
```ts
      const response = await chatStream(
        messages,
        await getEffectivePrompt('correlation_insights'),
        onChunk,
        'correlation_insights',
      );
```

- [ ] **Step 2: `log-analyzer.ts:37`**

Find the `chatStream(...)` call, add `'log_analyzer'` as 4th arg.

- [ ] **Step 3: `monitoring-service.ts:621`**

Add `'monitoring_analysis'` as 4th arg.

- [ ] **Step 4: `anomaly-explainer.ts:33` and `:131`**

Both call sites take `'anomaly_explainer'` as 4th arg.

- [ ] **Step 5: `incident-summarizer.ts:29`**

Add `'incident_summarizer'` as 4th arg.

- [ ] **Step 6: `investigation-service.ts:398`**

Add `'root_cause'` as 4th arg.

- [ ] **Step 7: Run ai-intelligence tests**

Run: `cd packages/ai-intelligence && npx vitest run`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/ai-intelligence/src/routes/correlations.ts packages/ai-intelligence/src/services/log-analyzer.ts packages/ai-intelligence/src/services/monitoring-service.ts packages/ai-intelligence/src/services/anomaly-explainer.ts packages/ai-intelligence/src/services/incident-summarizer.ts packages/ai-intelligence/src/services/investigation-service.ts
git commit -m "fix(llm): pass feature keys at ai-intelligence chatStream call sites"
```

---

## Task 6: Pass Feature Keys at Cross-Domain `chatStream` Call Sites

These consumers receive `chatStream` via the `LLMInterface` adapter built in `wiring.ts`. The interface change in Task 2 already exposed the optional `feature` parameter.

**Files:**
- Modify: `packages/security/src/services/pcap-analysis-service.ts:326`
- Modify: `packages/observability/src/routes/forecasts.ts:190`
- Modify: `packages/observability/src/routes/metrics.ts:310`
- Modify: `packages/operations/src/services/remediation-service.ts:323` and `:337`

- [ ] **Step 1: `pcap-analysis-service.ts:326`**

Find the `await llm.chatStream(...)` call (3-arg). Add `'pcap_analyzer'` as 4th argument.

- [ ] **Step 2: `forecasts.ts:190`**

Add `'capacity_forecast'` as 4th argument.

- [ ] **Step 3: `metrics.ts:310`**

Add `'metrics_summary'` as 4th argument.

- [ ] **Step 4: `remediation-service.ts:323` and `:337`**

Both call sites take `'remediation'` as 4th argument.

- [ ] **Step 5: Build the affected packages**

Run: `npm run build -w @dashboard/security -w @dashboard/observability -w @dashboard/operations`
Expected: success.

- [ ] **Step 6: Run cross-domain tests**

Run: `npx vitest run -w @dashboard/security -w @dashboard/observability -w @dashboard/operations`

If `vitest run -w` is not how this monorepo runs cross-package tests, fall back to:

```
cd packages/security && npx vitest run
cd packages/observability && npx vitest run
cd packages/operations && npx vitest run
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/security/src/services/pcap-analysis-service.ts packages/observability/src/routes/forecasts.ts packages/observability/src/routes/metrics.ts packages/operations/src/services/remediation-service.ts
git commit -m "fix(llm): pass feature keys at cross-domain chatStream call sites"
```

---

## Task 7: End-to-End Verification

- [ ] **Step 1: Type check the whole repo**

Run: `npm run typecheck`
Expected: zero errors.

- [ ] **Step 2: Lint the whole repo**

Run: `npm run lint`
Expected: zero errors.

- [ ] **Step 3: Full test suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 4: Manual verification (optional but recommended)**

In a running dev environment:

1. Open Settings → AI & LLM → Prompt Profiles.
2. Create a new profile, set `model = "test-model-XYZ"` for the `anomaly_explainer` feature, save and activate.
3. Trigger an anomaly explanation (or call the relevant endpoint).
4. Inspect the LLM trace store (`SELECT model FROM llm_traces ORDER BY created_at DESC LIMIT 1`) and confirm `model = test-model-XYZ`.

This step is informational only; do not block on it.

- [ ] **Step 5: Final commit if any followups**

If lint or typecheck surfaced cleanups, commit them as a final pass:

```bash
git add -A
git commit -m "chore: lint and typecheck cleanup after llm wiring fix"
```

---

## Self-Review Notes

- Spec coverage: every call site listed in the spec has a corresponding step. Open question on `llm-feedback.ts:279` is intentionally out of scope per the spec — no task added.
- No placeholders.
- Type consistency: `feature?: string` in the contract; `feature?: PromptFeature` inside ai-intelligence — narrower at the call site, wider at the boundary. Consistent across all tasks.
- Bucket layer / new UI: out of scope per the spec.

## Rollback

Each task ends in a self-contained commit. To rollback any single phase:

```bash
git revert <commit-sha>
```

To rollback the entire feature, revert all commits authored on this branch in reverse order. No DB migration, no setting key changes — settings written via the existing Profile UI continue to work either way.
