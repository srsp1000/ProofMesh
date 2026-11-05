import type { Permission, PrincipalType, RoleName } from '@proofmesh/contracts';

export interface SystemRoleDefinition {
  name: RoleName;
  description: string;
  permissions: readonly Permission[];
  allowsAgents: boolean;
}

export const HUMAN_ONLY_PERMISSIONS: readonly Permission[] = [
  'tenants:manage',
  'principals:manage',
  'roles:assign',
  'claims:attest',
  'claims:review',
  'audit:checkpoint'
] as const;

export const SYSTEM_ROLES: Record<RoleName, SystemRoleDefinition> = {
  admin: {
    name: 'admin',
    description: 'Tenant Administrator with unrestricted management privileges',
    permissions: [
      'tenants:manage',
      'workspaces:manage',
      'projects:manage',
      'principals:manage',
      'roles:assign',
      'credentials:manage',
      'claims:read',
      'claims:submit',
      'claims:evaluate',
      'claims:review',
      'claims:attest',
      'evidence:read',
      'evidence:ingest',
      'policy:read',
      'policy:manage',
      'audit:read',
      'audit:checkpoint'
    ],
    allowsAgents: false // Strict security rule: Agents can never possess administrative roles
  },
  compliance_officer: {
    name: 'compliance_officer',
    description: 'Authorized human compliance officer for claims review and attestation',
    permissions: [
      'claims:read',
      'claims:review',
      'claims:attest',
      'evidence:read',
      'policy:read',
      'policy:manage',
      'audit:read'
    ],
    allowsAgents: false // Strict non-negotiable rule: Agents cannot impersonate human reviewers
  },
  auditor: {
    name: 'auditor',
    description: 'Read-only compliance and forensic auditor',
    permissions: ['claims:read', 'evidence:read', 'policy:read', 'audit:read'],
    allowsAgents: false
  },
  developer: {
    name: 'developer',
    description:
      'Engineering role for integration development, claim submission, and evidence viewing',
    permissions: [
      'claims:read',
      'claims:submit',
      'evidence:read',
      'evidence:ingest',
      'policy:read'
    ],
    allowsAgents: true
  },
  agent_ingest: {
    name: 'agent_ingest',
    description:
      'Least-privilege automated agent identity for event telemetry and claim candidate submission',
    permissions: ['claims:submit', 'evidence:ingest'],
    allowsAgents: true
  }
};

export class AgentPrivilegeEscalationError extends Error {
  constructor(public readonly roleName: string) {
    super(
      `Security Violation: Agent identities cannot be granted human-restricted role '${roleName}'.`
    );
    this.name = 'AgentPrivilegeEscalationError';
  }
}

export class AgentHumanImpersonationError extends Error {
  constructor(public readonly permission: Permission) {
    super(
      `Security Violation: Agent identities are strictly prohibited from performing human action '${permission}'.`
    );
    this.name = 'AgentHumanImpersonationError';
  }
}

export class RBACPolicy {
  /**
   * Asserts whether a given role can be assigned to a specific principal type.
   * Prevents agents from assuming admin or reviewer roles.
   */
  static assertRoleAssignable(
    principalType: PrincipalType,
    roleName: RoleName | string,
    allowsAgents: boolean
  ): void {
    if (principalType === 'agent_identity' && !allowsAgents) {
      throw new AgentPrivilegeEscalationError(roleName);
    }
  }

  /**
   * Evaluates if a permission is restricted exclusively to human principals.
   */
  static isHumanOnly(permission: Permission): boolean {
    return HUMAN_ONLY_PERMISSIONS.includes(permission);
  }

  /**
   * Evaluates whether a principal possesses the required permission.
   * Guarantees that agent identities cannot execute human-only actions even if an unauthorized grant exists.
   */
  static hasPermission(
    principalType: PrincipalType,
    grantedPermissions: readonly Permission[],
    requiredPermission: Permission
  ): boolean {
    // Defense-in-depth: If permission is human-only, immediately deny agent identities
    if (principalType === 'agent_identity' && this.isHumanOnly(requiredPermission)) {
      return false;
    }

    return grantedPermissions.includes(requiredPermission);
  }

  /**
   * Asserts permission, throwing a domain error if unauthorized.
   */
  static assertPermission(
    principalType: PrincipalType,
    grantedPermissions: readonly Permission[],
    requiredPermission: Permission
  ): void {
    if (principalType === 'agent_identity' && this.isHumanOnly(requiredPermission)) {
      throw new AgentHumanImpersonationError(requiredPermission);
    }

    if (!grantedPermissions.includes(requiredPermission)) {
      throw new Error(`Unauthorized: Missing required permission '${requiredPermission}'.`);
    }
  }
}
