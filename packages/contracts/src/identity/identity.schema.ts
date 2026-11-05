import { z } from 'zod';

export const TenantStatusEnum = z.enum(['active', 'suspended', 'deprovisioned']);
export type TenantStatus = z.infer<typeof TenantStatusEnum>;

export const PrincipalTypeEnum = z.enum(['human_user', 'service_account', 'agent_identity']);
export type PrincipalType = z.infer<typeof PrincipalTypeEnum>;

export const TenantSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(100),
  slug: z
    .string()
    .min(2)
    .max(50)
    .regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with hyphens'),
  status: TenantStatusEnum,
  settings: z.record(z.unknown()).default({}),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});
export type TenantDTO = z.infer<typeof TenantSchema>;

export const CreateTenantSchema = z.object({
  name: z.string().min(1).max(100),
  slug: z
    .string()
    .min(2)
    .max(50)
    .regex(/^[a-z0-9-]+$/),
  settings: z.record(z.unknown()).optional()
});
export type CreateTenantInput = z.infer<typeof CreateTenantSchema>;

export const UpdateTenantSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  status: TenantStatusEnum.optional(),
  settings: z.record(z.unknown()).optional()
});
export type UpdateTenantInput = z.infer<typeof UpdateTenantSchema>;

export const WorkspaceSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  name: z.string().min(1).max(100),
  createdAt: z.string().datetime()
});
export type WorkspaceDTO = z.infer<typeof WorkspaceSchema>;

export const CreateWorkspaceSchema = z.object({
  name: z.string().min(1).max(100)
});
export type CreateWorkspaceInput = z.infer<typeof CreateWorkspaceSchema>;

export const ProjectSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  key: z
    .string()
    .min(2)
    .max(50)
    .regex(/^[A-Z0-9_-]+$/, 'Project key must be uppercase alphanumeric with underscores/hyphens'),
  name: z.string().min(1).max(100),
  createdAt: z.string().datetime()
});
export type ProjectDTO = z.infer<typeof ProjectSchema>;

export const CreateProjectSchema = z.object({
  workspaceId: z.string().uuid(),
  key: z
    .string()
    .min(2)
    .max(50)
    .regex(/^[A-Z0-9_-]+$/),
  name: z.string().min(1).max(100)
});
export type CreateProjectInput = z.infer<typeof CreateProjectSchema>;

export const PrincipalSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  type: PrincipalTypeEnum,
  identifier: z.string().min(1).max(255),
  displayName: z.string().min(1).max(100),
  isActive: z.boolean(),
  createdAt: z.string().datetime()
});
export type PrincipalDTO = z.infer<typeof PrincipalSchema>;

export const CreatePrincipalSchema = z.object({
  type: PrincipalTypeEnum,
  identifier: z.string().min(1).max(255),
  displayName: z.string().min(1).max(100)
});
export type CreatePrincipalInput = z.infer<typeof CreatePrincipalSchema>;

export const MembershipStatusEnum = z.enum(['active', 'invited', 'suspended']);
export type MembershipStatus = z.infer<typeof MembershipStatusEnum>;

export const MembershipSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  userPrincipalId: z.string().uuid(),
  status: MembershipStatusEnum,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});
export type MembershipDTO = z.infer<typeof MembershipSchema>;

export const CreateMembershipSchema = z.object({
  userPrincipalId: z.string().uuid(),
  status: MembershipStatusEnum.default('active')
});
export type CreateMembershipInput = z.infer<typeof CreateMembershipSchema>;
