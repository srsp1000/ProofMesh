import type {
  AdapterHealthStatus,
  AdapterHealthSummaryResponse,
  AdapterProtocolType,
  AdapterConnectionState
} from '@proofmesh/contracts';

interface AdapterInternalMetrics {
  adapterId: string;
  protocol: AdapterProtocolType;
  connectionStatus: AdapterConnectionState;
  lastEventAt: string | null;
  queueLag: number;
  eventRejectionCount: number;
  schemaIncompatibilityCount: number;
  cursor: number;
  head?: number;
  generation: string | null;
  gapCount: number;
  droppedEventsCount: number;
  permissionErrorsCount: number;
  details: Record<string, unknown>;
}

export class AdapterHealthService {
  private static instance: AdapterHealthService;
  private readonly adapters = new Map<string, AdapterInternalMetrics>();

  private constructor() {}

  public static getInstance(): AdapterHealthService {
    if (!AdapterHealthService.instance) {
      AdapterHealthService.instance = new AdapterHealthService();
    }
    return AdapterHealthService.instance;
  }

  /**
   * Resets all adapter metrics (primarily for test fixture isolation).
   */
  public reset(): void {
    this.adapters.clear();
  }

  /**
   * Registers or updates an adapter's presence.
   */
  public registerAdapter(
    adapterId: string,
    protocol: AdapterProtocolType,
    initialStatus: AdapterConnectionState = 'disconnected'
  ): void {
    if (!this.adapters.has(adapterId)) {
      this.adapters.set(adapterId, {
        adapterId,
        protocol,
        connectionStatus: initialStatus,
        lastEventAt: null,
        queueLag: 0,
        eventRejectionCount: 0,
        schemaIncompatibilityCount: 0,
        cursor: 0,
        generation: null,
        gapCount: 0,
        droppedEventsCount: 0,
        permissionErrorsCount: 0,
        details: {}
      });
    }
  }

  public recordConnectionStatus(
    adapterId: string,
    status: AdapterConnectionState,
    details?: Record<string, unknown>
  ): void {
    const entry = this.getOrCreate(adapterId);
    entry.connectionStatus = status;
    if (details) {
      entry.details = { ...entry.details, ...details };
    }
  }

  public recordEventReceived(adapterId: string, timestamp?: string): void {
    const entry = this.getOrCreate(adapterId);
    entry.lastEventAt = timestamp ?? new Date().toISOString();
  }

  public recordCursor(
    adapterId: string,
    cursor: number,
    generation?: string | null,
    head?: number
  ): void {
    const entry = this.getOrCreate(adapterId);
    entry.cursor = Math.max(entry.cursor, cursor);
    if (generation !== undefined) {
      entry.generation = generation;
    }
    if (head !== undefined) {
      entry.head = head;
      entry.queueLag = Math.max(0, head - entry.cursor);
    }
  }

  public recordGap(adapterId: string, resumedAt: number): void {
    const entry = this.getOrCreate(adapterId);
    entry.gapCount += 1;
    entry.cursor = resumedAt;
  }

  public recordEventRejection(adapterId: string): void {
    const entry = this.getOrCreate(adapterId);
    entry.eventRejectionCount += 1;
  }

  public recordSchemaIncompatibility(adapterId: string): void {
    const entry = this.getOrCreate(adapterId);
    entry.schemaIncompatibilityCount += 1;
  }

  public recordDroppedEvents(adapterId: string, count: number = 1): void {
    const entry = this.getOrCreate(adapterId);
    entry.droppedEventsCount += count;
  }

  public recordPermissionError(adapterId: string): void {
    const entry = this.getOrCreate(adapterId);
    entry.permissionErrorsCount += 1;
  }

  public getAdapterHealth(adapterId: string): AdapterHealthStatus | null {
    const entry = this.adapters.get(adapterId);
    if (!entry) return null;
    return this.mapToStatus(entry);
  }

  public getAggregateHealth(): AdapterHealthSummaryResponse {
    const adapterStatuses: AdapterHealthStatus[] = Array.from(this.adapters.values()).map((entry) =>
      this.mapToStatus(entry)
    );

    let overallStatus: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';

    const hasUnhealthy = adapterStatuses.some(
      (a) => a.connectionStatus === 'lapsed' || a.permissionErrorsCount > 10
    );
    const hasDegraded = adapterStatuses.some(
      (a) =>
        a.connectionStatus === 'degraded' ||
        a.connectionStatus === 'reconnecting' ||
        a.schemaIncompatibilityCount > 0 ||
        a.cursorStatus.gapCount > 0
    );

    if (hasUnhealthy) {
      overallStatus = 'unhealthy';
    } else if (hasDegraded) {
      overallStatus = 'degraded';
    }

    return {
      status: overallStatus,
      adapters: adapterStatuses,
      timestamp: new Date().toISOString()
    };
  }

  private getOrCreate(adapterId: string): AdapterInternalMetrics {
    let entry = this.adapters.get(adapterId);
    if (!entry) {
      entry = {
        adapterId,
        protocol: 'switch',
        connectionStatus: 'disconnected',
        lastEventAt: null,
        queueLag: 0,
        eventRejectionCount: 0,
        schemaIncompatibilityCount: 0,
        cursor: 0,
        generation: null,
        gapCount: 0,
        droppedEventsCount: 0,
        permissionErrorsCount: 0,
        details: {}
      };
      this.adapters.set(adapterId, entry);
    }
    return entry;
  }

  private mapToStatus(entry: AdapterInternalMetrics): AdapterHealthStatus {
    return {
      adapterId: entry.adapterId,
      protocol: entry.protocol,
      connectionStatus: entry.connectionStatus,
      lastEventAt: entry.lastEventAt,
      queueLag: entry.queueLag,
      eventRejectionCount: entry.eventRejectionCount,
      schemaIncompatibilityCount: entry.schemaIncompatibilityCount,
      cursorStatus: {
        cursor: entry.cursor,
        head: entry.head,
        generation: entry.generation,
        gapCount: entry.gapCount
      },
      droppedEventsCount: entry.droppedEventsCount,
      permissionErrorsCount: entry.permissionErrorsCount,
      details: entry.details
    };
  }
}
