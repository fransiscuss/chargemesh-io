import type { OcppEvent } from './eventBuilder.js';

export type EventFilter = {
  chargerIdentity?: string;
  action?: string | string[];
  source?: 'charger' | 'upstream';
};

export type EventHandler = (event: OcppEvent) => void | Promise<void>;

export interface EventBus {
  publish: (event: OcppEvent) => void;
  subscribe: (filter: EventFilter, handler: EventHandler) => () => void;
}

function matches(filter: EventFilter, event: OcppEvent): boolean {
  if (filter.chargerIdentity !== undefined && filter.chargerIdentity !== event.chargerIdentity)
    return false;
  if (filter.source !== undefined && filter.source !== event.source) return false;
  if (filter.action !== undefined) {
    const actions = Array.isArray(filter.action) ? filter.action : [filter.action];
    if (event.action === null || !actions.includes(event.action)) return false;
  }
  return true;
}

/** In-process fan-out bus. A slow or throwing subscriber never blocks the others. */
export class InProcessEventBus implements EventBus {
  private readonly subscribers = new Set<{ filter: EventFilter; handler: EventHandler }>();

  publish(event: OcppEvent): void {
    for (const subscriber of [...this.subscribers]) {
      if (!matches(subscriber.filter, event)) continue;
      try {
        const result = subscriber.handler(event);
        if (result instanceof Promise) result.catch(() => undefined);
      } catch {
        // One bad subscriber must not affect the rest.
      }
    }
  }

  subscribe(filter: EventFilter, handler: EventHandler): () => void {
    const subscriber = { filter, handler };
    this.subscribers.add(subscriber);
    return () => {
      this.subscribers.delete(subscriber);
    };
  }

  get subscriberCount(): number {
    return this.subscribers.size;
  }
}
