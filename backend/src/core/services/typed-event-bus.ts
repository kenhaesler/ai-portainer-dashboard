import type { DashboardEvent, DashboardEventType, EventHandler } from '@dashboard/contracts';
import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('event-bus');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyHandler = EventHandler<any>;
type AnyEventHandler = (event: DashboardEvent) => void | Promise<void>;

class TypedEventBus {
  private readonly handlers = new Map<string, Set<AnyHandler>>();
  private readonly anyHandlers = new Set<AnyEventHandler>();

  /**
   * Emit a typed event synchronously. Each handler is called with error isolation —
   * a failing handler does not prevent subsequent handlers from running.
   */
  emit<T extends DashboardEventType>(
    type: T,
    data: Extract<DashboardEvent, { type: T }>['data'],
  ): void {
    log.debug({ eventType: type }, 'Event emitted');
    const event = { type, data } as Extract<DashboardEvent, { type: T }>;

    const typeHandlers = this.handlers.get(type);
    if (typeHandlers) {
      for (const handler of typeHandlers) {
        try {
          handler(event);
        } catch (err) {
          log.error({ err, eventType: type }, 'Event handler threw synchronously');
        }
      }
    }

    for (const handler of this.anyHandlers) {
      try {
        handler(event as DashboardEvent);
      } catch (err) {
        log.error({ err, eventType: type }, 'Wildcard event handler threw synchronously');
      }
    }
  }

  /**
   * Emit a typed event and await all handlers. Handlers run in parallel.
   * A failing handler does not reject the returned promise.
   */
  async emitAsync<T extends DashboardEventType>(
    type: T,
    data: Extract<DashboardEvent, { type: T }>['data'],
  ): Promise<void> {
    log.debug({ eventType: type }, 'Event emitted (async)');
    const event = { type, data } as Extract<DashboardEvent, { type: T }>;

    const promises: Promise<void>[] = [];

    const typeHandlers = this.handlers.get(type);
    if (typeHandlers) {
      for (const handler of typeHandlers) {
        promises.push(
          Promise.resolve()
            .then(() => handler(event))
            .catch((err) => {
              log.error({ err, eventType: type }, 'Async event handler error');
            }),
        );
      }
    }

    for (const handler of this.anyHandlers) {
      promises.push(
        Promise.resolve()
          .then(() => handler(event as DashboardEvent))
          .catch((err) => {
            log.error({ err, eventType: type }, 'Async wildcard handler error');
          }),
      );
    }

    await Promise.all(promises);
  }

  /**
   * Subscribe to a specific event type.
   * Returns an unsubscribe function — call it to remove the handler.
   */
  on<T extends DashboardEventType>(type: T, handler: EventHandler<T>): () => void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set());
    }
    this.handlers.get(type)!.add(handler as AnyHandler);
    return () => {
      this.handlers.get(type)?.delete(handler as AnyHandler);
    };
  }

  /**
   * Subscribe to ALL event types (catch-all).
   * Useful for cross-cutting concerns like webhook dispatch.
   * Returns an unsubscribe function.
   */
  onAny(handler: AnyEventHandler): () => void {
    this.anyHandlers.add(handler);
    return () => {
      this.anyHandlers.delete(handler);
    };
  }
}

/** Singleton typed event bus — the single cross-domain communication channel. */
export const eventBus = new TypedEventBus();
