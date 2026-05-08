# Per-Feature LLM Model Wiring — Design

Status: approved (2026-05-08)
Author: brainstorming session
Tracking: TBD (link issue/PR after creation)

## Summary

Per-feature `model` and `temperature` overrides configured via Prompt Profiles are stored correctly but never take effect at runtime. Every LLM call resolves the model from the global `getEffectiveLlmConfig()` exported by `@dashboard/core/services/settings-store.js`, which has no knowledge of the active profile's per-feature overrides.

This change wires every LLM consumer through the existing feature-aware resolver in `packages/ai-intelligence/src/services/prompt-store.ts`, so that profile-level per-feature model and temperature settings actually drive the LLM request.

No new UI is added. No new resolution layer is introduced. No DB migration. The existing Profile editor in `tab-ai-llm.tsx` already provides the per-feature configuration surface.

## Problem

The codebase has two functions named `getEffectiveLlmConfig`:

1. **Global resolver** — `packages/core/src/services/settings-store.ts`. Returns `{ apiUrl, apiToken, model, authType, maxTokens, maxToolIterations }`. Knows nothing about features.
2. **Feature-aware resolver** — `packages/ai-intelligence/src/services/prompt-store.ts`. Wraps the global resolver and overrides `model` / `temperature` based on resolution order: per-feature setting (`prompts.<feature>.model`) → active profile's per-feature config → global default.

Every LLM call site imports the **global** resolver. The feature-aware resolver is exported but never called from outside `prompt-store.ts`.

Result: a user who creates a profile that pins `qwen3:32b` for `root_cause` and `llama3.2:1b` for `chat_assistant` sees no behavioural difference. Both calls hit whatever model is set in the global LLM config.

## Approach

Switch every LLM call site that represents a known `PromptFeature` to the feature-aware resolver. Pass the feature key through the call stack to the resolver.

The resolution chain is unchanged from what already exists in `prompt-store.ts`:

```
prompts.<feature>.model setting    (highest priority — individual override)
        ↓ if absent
active profile.prompts[feature].model    (profile-level override)
        ↓ if absent
global config (settings DB or env LLM_MODEL)    (fallback)
```

Same chain applies to `temperature`.

## Call Site Changes

### Direct edits in `packages/ai-intelligence`

| File | Line | Feature key |
|------|------|-------------|
| `sockets/llm-chat.ts` | 605 | `chat_assistant` |
| `routes/llm.ts` | 92 (AI search) | `command_palette` |
| `routes/llm.ts` | 301 (test-prompt) | use `feature` param from request body |
| `routes/correlations.ts` | 312 | `correlation_insights` |
| `services/log-analyzer.ts` | 37 | `log_analyzer` |
| `services/monitoring-service.ts` | 621 | `monitoring_analysis` |
| `services/anomaly-explainer.ts` | 33, 131 | `anomaly_explainer` |
| `services/incident-summarizer.ts` | 29 | `incident_summarizer` |
| `services/investigation-service.ts` | 398 | `root_cause` |

### Cross-domain consumers (via `LlmInterface` DI)

| File | Line | Feature key |
|------|------|-------------|
| `packages/security/src/services/pcap-analysis-service.ts` | 326 | `pcap_analyzer` |
| `packages/observability/src/routes/forecasts.ts` | 190 | `capacity_forecast` |
| `packages/observability/src/routes/metrics.ts` | 310 | `metrics_summary` |
| `packages/operations/src/services/remediation-service.ts` | 323, 337 | `remediation` |

### Intentionally unchanged

| File | Line | Reason |
|------|------|--------|
| `routes/llm.ts` | 245 (test-connection) | Lists models for UI; no LLM inference |
| `routes/llm.ts` | 421 (list models) | Lists models; no LLM inference |
| `services/llm-client.ts` | 397 (`isLlmAvailable`) | Reachability ping; no inference |
| `routes/llm-feedback.ts` | 279 (feedback analysis) | Admin-only, no matching `PromptFeature`; deferred |

## Code Shape

### `chatStream` — central funnel

`chatStream` is the central funnel for most inference sites (correlations, log analyzer, monitoring service, anomaly explainer, incident summarizer, investigation service, plus the cross-domain consumers: pcap, forecasts, metrics, remediation). Adding an optional `feature` parameter handles them centrally; only three direct fetch sites (`sockets/llm-chat.ts:605`, `routes/llm.ts:92`, `routes/llm.ts:301`) need separate edits.

```ts
// packages/ai-intelligence/src/services/llm-client.ts
import { getEffectiveLlmConfig } from './prompt-store.js';  // swap from core
import type { PromptFeature } from './prompt-store.js';

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

async function chatStreamInner(
  messages: ChatMessage[],
  systemPrompt: string,
  onChunk: (chunk: string) => void,
  feature?: PromptFeature,
): Promise<string> {
  const llmConfig = await getEffectiveLlmConfig(feature);
  // ... existing body ...

  const requestBody = {
    model: llmConfig.model,
    messages: fullMessages,
    stream: true,
    ...(llmConfig.temperature !== undefined ? { temperature: llmConfig.temperature } : {}),
  };
}
```

### `LlmInterface` contract

```ts
// packages/contracts/src/interfaces/llm-interface.ts
export interface LlmInterface {
  chatStream(
    messages: ChatMessage[],
    systemPrompt: string,
    onChunk: (chunk: string) => void,
    feature?: PromptFeature,
  ): Promise<string>;
}
```

`PromptFeature` must be exported from `@dashboard/contracts` (re-exported from a shared location) so cross-domain packages can pass it without importing from `@dashboard/ai-intelligence`. Cleanest path: define the type union in `@dashboard/contracts/schemas/prompt-feature.ts` and have `prompt-store.ts` import it.

### Direct call sites (non-`chatStream`)

For `sockets/llm-chat.ts:605` and `routes/llm.ts:92` (which build their own fetch bodies), swap the import to the feature-aware resolver and inject the feature key:

```ts
import { getEffectiveLlmConfig } from '../services/prompt-store.js';
// ...
const llmConfig = await getEffectiveLlmConfig('chat_assistant');
```

Both sites also need to spread `temperature` into their request bodies if present, so profile temperature overrides take effect.

## Temperature in Request Bodies

Today, `chatStreamInner` does not include `temperature` in the OpenAI request. Most direct call sites (`routes/llm.ts:92`, `sockets/llm-chat.ts:605`) also omit it. After this change, every call site that obtains an `llmConfig` via the feature-aware resolver must conditionally include `temperature` in the request body when defined:

```ts
...(llmConfig.temperature !== undefined ? { temperature: llmConfig.temperature } : {})
```

Profiles that don't set a temperature continue to use the provider default.

## Testing

### Unit

Extend `packages/ai-intelligence/src/services/prompt-store.test.ts`:

- `getEffectiveLlmConfig(feature)` returns the profile's per-feature `model` when the active profile defines it for that feature.
- `getEffectiveLlmConfig(feature)` returns the profile's per-feature `temperature` when defined.
- Per-feature setting (`prompts.<feature>.model`) takes priority over profile config.
- Falls back to global config when no profile or feature-level override exists.
- `getEffectiveLlmConfig()` (no feature) returns global config unchanged.

### Integration

Add a test (or extend an existing service test) that:

1. Creates a non-default profile setting `model = "test-model-X"` for `anomaly_explainer`.
2. Activates that profile.
3. Calls `explainAnomaly(...)` with a mocked `fetch`.
4. Asserts the OpenAI request body's `model` field equals `"test-model-X"`.

Repeat for one cross-domain feature (e.g. `pcap_analyzer`) to verify the DI path works.

### Regression

- Existing `tab-ai-llm.test.tsx` profile editor tests continue to pass.
- Existing `chatStream` tests in `llm-client.test.ts` continue to pass when called without a feature key.

## Open Questions Resolved During Brainstorm

- **Should this introduce a higher-level "buckets" UI (Chat / Analysis / Summarization) on top of per-feature?** — No. Defer. The Profiles UI already covers per-feature configuration; adding buckets duplicates the concept.
- **Should `routes/llm-feedback.ts:279` get a new `feedback_analysis` feature key?** — No. Defer. Admin-only, low-volume, not user-facing. Adding a new feature creates UI surface (Profiles editor, fixtures, default prompts) for marginal gain.

## Rollback

Single-PR change. Rollback = `git revert`. No DB migration. No setting key changes. Existing `prompts.<feature>.model` values in the settings table remain valid and continue to be respected by the resolver.

## Out of Scope

- Bucket-level abstraction (Chat / Analysis / Summarization)
- New `feedback_analysis` feature
- New default-models settings panel separate from Profiles
- Per-call temperature configuration through `chatStream` arguments (continues to come from profile config only)
- Changes to `max_tokens` resolution (stays a single global value)
