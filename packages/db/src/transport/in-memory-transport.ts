import type { CanonicalEventEnvelope, PriorityLane } from '@proofmesh/contracts';
import type { EventTransport, EventHandler } from './event-transport.interface.js';

export class TransportUnavailableError extends Error {
  constructor(message = 'Event transport is currently unavailable') {
    super(message);
    this.name = 'TransportUnavailableError';
  }
}

export class InMemoryEventTransport implements EventTransport {
  private readonly subscribers = new Map<PriorityLane, Set<EventHandler>>([
    ['high_priority', new Set()],
    ['bulk_telemetry', new Set()]
  ]);

  private readonly queues = new Map<PriorityLane, CanonicalEventEnvelope[]>([
    ['high_priority', []],
    ['bulk_telemetry', []]
  ]);

  private isFailing = false;

  async publish(lane: PriorityLane, event: CanonicalEventEnvelope): Promise<void> {
    if (this.isFailing) {
      throw new TransportUnavailableError('Simulated transport outage');
    }

    const queue = this.queues.get(lane);
    if (queue) {
      queue.push(event);
    }

    const handlers = this.subscribers.get(lane);
    if (handlers && handlers.size > 0) {
      // Dispatch asynchronously to all registered subscribers
      for (const handler of handlers) {
        // Remove from queue upon dispatch
        const idx = queue?.indexOf(event) ?? -1;
        if (idx !== -1 && queue) {
          queue.splice(idx, 1);
        }
        await handler(event);
      }
    }
  }

  subscribe(lane: PriorityLane, handler: EventHandler): () => void {
    const handlers = this.subscribers.get(lane);
    if (handlers) {
      handlers.add(handler);
    }
    return () => {
      handlers?.delete(handler);
    };
  }

  async getQueueLag(lane: PriorityLane): Promise<number> {
    return this.queues.get(lane)?.length ?? 0;
  }

  isAvailable(): boolean {
    return !this.isFailing;
  }

  setSimulatedFailure(fail: boolean): void {
    this.isFailing = fail;
  }

  clear(): void {
    this.queues.get('high_priority')?.splice(0);
    this.queues.get('bulk_telemetry')?.splice(0);
    this.subscribers.get('high_priority')?.clear();
    this.subscribers.get('bulk_telemetry')?.clear();
    this.isFailing = false;
  }
}
