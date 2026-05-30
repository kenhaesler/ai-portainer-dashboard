import type { NormalizedEndpoint } from '../schemas/endpoint.js';
import type { NormalizedContainer } from '../schemas/container.js';
import type { Insight } from '../schemas/insight.js';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
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
   */
  chatStream(
    messages: ChatMessage[],
    systemPrompt: string,
    onChunk: (chunk: string) => void,
    feature?: string,
  ): Promise<string>;
  buildInfrastructureContext(
    endpoints: NormalizedEndpoint[],
    containers: NormalizedContainer[],
    insights: Insight[],
  ): string;
  /** Retrieve the effective system prompt for a named domain (e.g. 'pcap_analyzer'). */
  getEffectivePrompt(domain: string): Promise<string>;
}
