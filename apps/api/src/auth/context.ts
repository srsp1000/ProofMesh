import { AsyncLocalStorage } from 'node:async_hooks';
import type { Permission, PrincipalType } from '@proofmesh/contracts';

export interface RequestContext {
  tenantId: string;
  principalId: string;
  principalType: PrincipalType;
  identifier: string;
  displayName: string;
  permissions: Permission[];
  correlationId: string;
}

const asyncLocalStorage = new AsyncLocalStorage<RequestContext>();

export function getRequestContext(): RequestContext | undefined {
  return asyncLocalStorage.getStore();
}

export function requireRequestContext(): RequestContext {
  const ctx = asyncLocalStorage.getStore();
  if (!ctx) {
    throw new Error(
      'Security Violation: Active tenant request context is missing in execution scope.'
    );
  }
  return ctx;
}

export function runWithContext<T>(context: RequestContext, callback: () => T): T {
  return asyncLocalStorage.run(context, callback);
}
