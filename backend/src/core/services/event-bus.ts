import { EventEmitter } from 'node:events';
import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('event-bus');

export interface WebhookEvent {
  type: string;
  timestamp: string;
  data: Record<string, unknown>;
}

const emitter = new EventEmitter();
emitter.setMaxListeners(50);

export function emitEvent(event: WebhookEvent): void {
  log.debug({ eventType: event.type }, 'Event emitted');
  emitter.emit('event', event);
}

export function onEvent(handler: (event: WebhookEvent) => void): () => void {
  emitter.on('event', handler);
  return () => {
    emitter.off('event', handler);
  };
}

export function getEmitter(): EventEmitter {
  return emitter;
}
