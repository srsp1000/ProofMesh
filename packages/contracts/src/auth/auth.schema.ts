import { z } from 'zod';

export const PermissionEnum = z.enum([
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
  'claims:attest', // Strictly human-only
  'evidence:read',
  'evidence:ingest',
  'policy:read',
  'policy:manage',
  'audit:read',
  'audit:checkpoint'
]);
export type Permission = z.infer<typeof PermissionEnum>;

export const RoleNameEnum = z.enum([
  'admin',
  'compliance_officer',
  'auditor',
  'developer',
  'agent_ingest'
]);
export type RoleName = z.infer<typeof RoleNameEnum>;

export const RoleScopeEnum = z.enum(['tenant', 'workspace', 'project']);
export type RoleScope = z.infer<typeof RoleScopeEnum>;

export const RoleSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid().nullable(),
  name: z.string().min(1).max(50),
  description: z.string().max(255),
  permissions: z.array(PermissionEnum),
  isSystem: z.boolean(),
  allowsAgents: z.boolean(),
  createdAt: z.string().datetime()
});
export type RoleDTO = z.infer<typeof RoleSchema>;

export const RoleAssignmentSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  principalId: z.string().uuid(),
  roleId: z.string().uuid(),
  scopeType: RoleScopeEnum,
  scopeId: z.string().uuid().nullable(),
  assignedBy: z.string().uuid().nullable(),
  createdAt: z.string().datetime()
});
export type RoleAssignmentDTO = z.infer<typeof RoleAssignmentSchema>;

export const AssignRoleInputSchema = z.object({
  principalId: z.string().uuid(),
  roleId: z.string().uuid(),
  scopeType: RoleScopeEnum.default('tenant'),
  scopeId: z.string().uuid().optional()
});
export type AssignRoleInput = z.infer<typeof AssignRoleInputSchema>;

// API Keys / Service Credentials
export const CreateApiKeyInputSchema = z.object({
  principalId: z.string().uuid(),
  name: z.string().min(1).max(100),
  scopes: z.array(PermissionEnum).min(1),
  expiresInDays: z.number().int().min(1).max(365).default(90)
});
export type CreateApiKeyInput = z.infer<typeof CreateApiKeyInputSchema>;

export const ApiKeyResponseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  keyPrefix: z.string(),
  secretToken: z.string().optional(), // Returned strictly once upon creation
  scopes: z.array(PermissionEnum),
  expiresAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime()
});
export type ApiKeyResponse = z.infer<typeof ApiKeyResponseSchema>;

export const RevokeApiKeyInputSchema = z.object({
  keyId: z.string().uuid(),
  reason: z.string().min(1).max(255).default('Manual revocation')
});
export type RevokeApiKeyInput = z.infer<typeof RevokeApiKeyInputSchema>;

export const RotateApiKeyInputSchema = z.object({
  keyId: z.string().uuid(),
  expiresInDays: z.number().int().min(1).max(365).default(90)
});
export type RotateApiKeyInput = z.infer<typeof RotateApiKeyInputSchema>;

// Connector Credentials (Secret references only)
export const ConnectorCredentialSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  projectId: z.string().uuid(),
  name: z.string().min(1).max(100),
  connectorType: z.string().min(1).max(50),
  credentialRef: z.string().min(1).max(255),
  maskedIdentity: z.string().max(100),
  status: z.enum(['active', 'expired', 'revoked']),
  expiresAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});
export type ConnectorCredentialDTO = z.infer<typeof ConnectorCredentialSchema>;

export const StoreConnectorCredentialSchema = z.object({
  projectId: z.string().uuid(),
  name: z.string().min(1).max(100),
  connectorType: z.string().min(1).max(50),
  plaintextSecret: z.string().min(1).max(4096), // Sent to secret manager, never stored in DB
  maskedIdentity: z.string().max(100),
  expiresAt: z.string().datetime().optional()
});
export type StoreConnectorCredentialInput = z.infer<typeof StoreConnectorCredentialSchema>;

// OIDC JWT Token Claims
export const AuthTokenClaimsSchema = z.object({
  sub: z.string().min(1),
  iss: z.string().url(),
  aud: z.union([z.string(), z.array(z.string())]),
  exp: z.number().int(),
  iat: z.number().int(),
  email: z.string().email().optional(),
  name: z.string().optional(),
  tenant_id: z.string().uuid().optional(), // Extracted if provided by enterprise IdP claim
  roles: z.array(z.string()).optional()
});
export type AuthTokenClaims = z.infer<typeof AuthTokenClaimsSchema>;
