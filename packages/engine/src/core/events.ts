import type { GameEventKey, GameEvents } from '../types.js';

type Handler<K extends GameEventKey> = (payload: GameEvents[K]) => void;

/** Small typed event emitter used for engine <-> host integration. */
export class EventBus {
  private handlers = new Map<GameEventKey, Set<Handler<any>>>();

  on<K extends GameEventKey>(event: K, handler: Handler<K>): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler);
    return () => set!.delete(handler);
  }

  emit<K extends GameEventKey>(event: K, payload: GameEvents[K]): void {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const h of [...set]) {
      try {
        h(payload);
      } catch (err) {
        // Host handler errors must never break the sim loop.
        console.error(`[takeon] event handler for "${event}" threw`, err);
      }
    }
  }

  clear(): void {
    this.handlers.clear();
  }
}
