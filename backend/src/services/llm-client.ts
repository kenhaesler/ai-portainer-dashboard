import { Ollama } from 'ollama';
import { getConfig } from '../config/index.js';
import { createChildLogger } from '../utils/logger.js';
import type { NormalizedEndpoint, NormalizedContainer } from './portainer-normalizers.js';
import type { Insight } from '../models/monitoring.js';

const log = createChildLogger('llm-client');

let client: Ollama | null = null;

function getClient(): Ollama {
  if (!client) {
    const config = getConfig();
    client = new Ollama({ host: config.OLLAMA_BASE_URL });
    log.info({ baseUrl: config.OLLAMA_BASE_URL }, 'Ollama client initialized');
  }
  return client;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export async function chatStream(
  messages: ChatMessage[],
  systemPrompt: string,
  onChunk: (chunk: string) => void,
): Promise<string> {
  const config = getConfig();
  const ollama = getClient();

  const fullMessages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    ...messages,
  ];

  let fullResponse = '';

  try {
    const response = await ollama.chat({
      model: config.OLLAMA_MODEL,
      messages: fullMessages,
      stream: true,
    });

    for await (const part of response) {
      const content = part.message?.content || '';
      if (content) {
        fullResponse += content;
        onChunk(content);
      }
    }

    log.debug({ model: config.OLLAMA_MODEL, responseLength: fullResponse.length }, 'Chat stream completed');
    return fullResponse;
  } catch (err) {
    log.error({ err }, 'Ollama chat stream failed');
    throw err;
  }
}

export function buildInfrastructureContext(
  endpoints: NormalizedEndpoint[],
  containers: NormalizedContainer[],
  insights: Insight[],
): string {
  const endpointSummary = endpoints
    .map((ep) => `- ${ep.name} (${ep.status}): ${ep.containersRunning} running, ${ep.containersStopped} stopped`)
    .join('\n');

  const runningContainers = containers.filter((c) => c.state === 'running');
  const stoppedContainers = containers.filter((c) => c.state === 'stopped');
  const unhealthyContainers = containers.filter(
    (c) => c.state === 'dead' || c.state === 'paused',
  );

  const containerSummary = [
    `Total: ${containers.length}`,
    `Running: ${runningContainers.length}`,
    `Stopped: ${stoppedContainers.length}`,
    `Unhealthy/Dead: ${unhealthyContainers.length}`,
  ].join(', ');

  const containerDetails = containers
    .slice(0, 50)
    .map((c) => `- ${c.name} (${c.image}): ${c.state} on ${c.endpointName}`)
    .join('\n');

  const recentInsights = insights
    .slice(0, 20)
    .map((i) => `- [${i.severity.toUpperCase()}] ${i.title}: ${i.description}`)
    .join('\n');

  return `You are an AI assistant specializing in Docker container infrastructure management. You have access to the following infrastructure data:

## Endpoints
${endpointSummary || 'No endpoints available.'}

## Container Summary
${containerSummary}

## Container Details
${containerDetails || 'No containers available.'}

## Recent Insights
${recentInsights || 'No recent insights.'}

Provide concise, actionable recommendations. When suggesting changes, always explain the potential impact and risks. Never perform destructive actions without explicit user confirmation.`;
}

export async function isOllamaAvailable(): Promise<boolean> {
  try {
    const ollama = getClient();
    await ollama.list();
    return true;
  } catch {
    log.warn('Ollama is not available');
    return false;
  }
}
