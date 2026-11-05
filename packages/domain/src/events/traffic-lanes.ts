import type { PriorityLane } from '@proofmesh/contracts';

export class TrafficLaneClassifier {
  private static readonly HIGH_PRIORITY_PATTERNS = [
    /\.review\./,
    /\.approval\./,
    /\.decision\./,
    /\.remediation\./,
    /\.claim\./,
    /\.health\./
  ];

  public static classify(eventType: string): PriorityLane {
    for (const pattern of this.HIGH_PRIORITY_PATTERNS) {
      if (pattern.test(eventType)) {
        return 'high_priority';
      }
    }
    return 'bulk_telemetry';
  }

  public static isHighPriority(eventType: string): boolean {
    return this.classify(eventType) === 'high_priority';
  }
}
