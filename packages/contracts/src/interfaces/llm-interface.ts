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
}
