import type { TenantStatus } from '@proofmesh/contracts';

export class InvalidTenantTransitionError extends Error {
  constructor(
    public readonly from: TenantStatus,
    public readonly to: TenantStatus
  ) {
    super(`Illegal tenant transition from '${from}' to '${to}'.`);
    this.name = 'InvalidTenantTransitionError';
  }
}

export class DeprovisionedTenantAccessError extends Error {
  constructor(public readonly tenantId: string) {
    super(`Access denied: Tenant '${tenantId}' has been deprovisioned.`);
    this.name = 'DeprovisionedTenantAccessError';
  }
}

const ALLOWED_TENANT_TRANSITIONS: Record<TenantStatus, readonly TenantStatus[]> = {
  active: ['suspended', 'deprovisioned'],
  suspended: ['active', 'deprovisioned'],
  deprovisioned: [] // Terminal state
};

export class TenantLifecycle {
  static canTransition(from: TenantStatus, to: TenantStatus): boolean {
    const allowed = ALLOWED_TENANT_TRANSITIONS[from];
    return allowed ? allowed.includes(to) : false;
  }

  static transition(from: TenantStatus, to: TenantStatus): TenantStatus {
    if (!this.canTransition(from, to)) {
      throw new InvalidTenantTransitionError(from, to);
    }
    return to;
  }

  static assertAccessible(status: TenantStatus, tenantId: string): void {
    if (status === 'deprovisioned') {
      throw new DeprovisionedTenantAccessError(tenantId);
    }
    if (status === 'suspended') {
      throw new Error(`Tenant '${tenantId}' is suspended. Operational access is paused.`);
    }
  }
}
