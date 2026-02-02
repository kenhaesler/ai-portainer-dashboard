import { Namespace } from 'socket.io';
import { createChildLogger } from '../utils/logger.js';
import { getConfig } from '../config/index.js';
import { Ollama } from 'ollama';

const log = createChildLogger('socket:llm');

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

// Per-session conversation history
const sessions = new Map<string, ChatMessage[]>();

export function setupLlmNamespace(ns: Namespace) {
  ns.on('connection', (socket) => {
    const userId = socket.data.user?.sub || 'unknown';
    log.info({ userId }, 'LLM client connected');

    let abortController: AbortController | null = null;

    socket.on('chat:message', async (data: { message: string; context?: string }) => {
      const config = getConfig();

      // Get or create session history
      if (!sessions.has(socket.id)) {
        sessions.set(socket.id, []);
      }
      const history = sessions.get(socket.id)!;

      // Build messages
      const systemPrompt = `You are an AI assistant specializing in Docker container infrastructure management powered by Portainer. You help operators understand their infrastructure, diagnose issues, and suggest remediation actions.

${data.context ? `Current infrastructure context:\n${data.context}` : ''}

Provide concise, actionable responses. Use markdown formatting for code blocks and lists. When suggesting actions, explain the reasoning.`;

      history.push({ role: 'user', content: data.message });

      const messages = [
        { role: 'system' as const, content: systemPrompt },
        ...history.slice(-20), // Keep last 20 messages
      ];

      try {
        const ollama = new Ollama({ host: config.OLLAMA_BASE_URL });
        abortController = new AbortController();

        socket.emit('chat:start');

        const response = await ollama.chat({
          model: config.OLLAMA_MODEL,
          messages,
          stream: true,
        });

        let fullResponse = '';
        for await (const chunk of response) {
          if (abortController?.signal.aborted) break;
          const text = chunk.message?.content || '';
          fullResponse += text;
          socket.emit('chat:chunk', { text });
        }

        history.push({ role: 'assistant', content: fullResponse });
        socket.emit('chat:end', { fullResponse });
      } catch (err) {
        log.error({ err }, 'LLM chat error');
        socket.emit('chat:error', {
          error: err instanceof Error ? err.message : 'LLM unavailable',
        });
      } finally {
        abortController = null;
      }
    });

    socket.on('chat:cancel', () => {
      if (abortController) {
        abortController.abort();
        socket.emit('chat:cancelled');
      }
    });

    socket.on('chat:clear', () => {
      sessions.delete(socket.id);
      socket.emit('chat:cleared');
    });

    socket.on('disconnect', () => {
      sessions.delete(socket.id);
      log.info({ userId }, 'LLM client disconnected');
    });
  });
}
