import { ForbiddenException } from "@nestjs/common";

export interface AuthenticatedRequest { user?: { sub: string; tenantId?: string; roles?: string[] }; }

/** Only tenant-unscoped (platform-level) tokens may act on an arbitrary tenantId. */
export function requireTenantScope(req: AuthenticatedRequest, tenantId: string) {
  if (req.user!.tenantId && req.user!.tenantId !== tenantId) {
    throw new ForbiddenException("Cannot access another tenant's data.");
  }
}
