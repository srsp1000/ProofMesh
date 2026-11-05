import type { CanonicalEventEnvelope, PriorityLane } from '@proofmesh/contracts';

export type EventHandler = (event: CanonicalEventEnvelope) => Promise<void>;

export interface EventTransport {
  publish(lane: PriorityLane, event: CanonicalEventEnvelope): Promise<void>;
  subscribe(lane: PriorityLane, handler: EventHandler): () => void;
  getQueueLag(lane: PriorityLane): Promise<number>;
  isAvailable(): boolean;
  setSimulatedFailure(fail: boolean): void;
}
