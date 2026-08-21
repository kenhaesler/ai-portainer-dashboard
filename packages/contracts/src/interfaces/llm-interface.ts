import type { NormalizedEndpoint } from '../schemas/endpoint.js';
import type { NormalizedContainer } from '../schemas/container.js';
import type { Insight } from '../schemas/insight.js';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * Stateful streaming filter that suppresses reasoning (`<think>...</think>`)
 * blocks from live LLM chunk streams. Feed chunks via `process()`; call
 * `flush()` once at end-of-stream to drain any buffered residual.
 */
export interface LlmStreamFilter {
  /** Process a streaming chunk. Returns the text safe to emit (may be empty). */
  process(chunk: string): string;
  /** Flush the remaining buffer at end of stream. */
  flush(): string;
}

/**
 * Abstract interface for LLM access.
 * Implemented by llm-client in @dashboard/ai-intelligence.
 * Injected into cross-domain consumers (observability forecasts, operations remediation).
 */
export interface LLMInterface {
  isAvailable(): Promise<boolean>;
  /**
   * Stream an LLM chat completion. Pass `feature` (e.g. 'pcap_analyzer',
   * 'capacity_forecast') so per-feature model and temperature overrides
   * from the active prompt profile take effect.
   *
   * The resolved string is the fully sanitized response (thinking blocks,
   * tool-call JSON, and system-prompt-leak patterns stripped centrally).
   * `onChunk` receives raw chunks — live-stream consumers must pass them
   * through `createStreamFilter()` and treat the resolved value as the
   * authoritative final message (#1516).
   */
  chatStream(
    messages: ChatMessage[],
    systemPrompt: string,
    onChunk: (chunk: string) => void,
    feature?: string,
    options?: {
      /**
       * Default true (SSE streaming). Buffered callers that pass a no-op
       * onChunk set false so the gateway serves one JSON completion instead
       * of holding a streaming slot for the whole generation (#1667).
       */
      stream?: boolean;
    },
  ): Promise<string>;
  /**
   * Create a fresh streaming filter for one live chunk stream (strips
   * `<think>` reasoning blocks as chunks arrive). Optional so hand-rolled
   * test doubles keep compiling — consumers must emit nothing raw when it
   * is absent and rely on `chatStream`'s sanitized return value instead.
   */
  createStreamFilter?(): LlmStreamFilter;
  buildInfrastructureContext(
    endpoints: NormalizedEndpoint[],
    containers: NormalizedContainer[],
    insights: Insight[],
  ): string;
  /** Retrieve the effective system prompt for a named domain (e.g. 'pcap_analyzer'). */
  getEffectivePrompt(domain: string): Promise<string>;
}
