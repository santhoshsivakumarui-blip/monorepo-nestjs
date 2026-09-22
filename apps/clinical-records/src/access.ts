import { ForbiddenException } from "@nestjs/common";

export interface AuthenticatedRequest { user?: { sub: string; tenantId?: string }; }

/**
 * The first domain in this codebase readable/writable by either a hospital
 * staff member (tenant-scoped) or the patient themselves (self-scoped) — a
 * staff caller's token tenantId must match; a patient caller (no tenantId on
 * their token) must be the patient in question.
 */
export function requireStaffOrSelf(req: AuthenticatedRequest, userId: string, tenantId: string) {
  const caller = req.user!;
  if (caller.tenantId) {
    if (caller.tenantId !== tenantId) {
      throw new ForbiddenException("Cannot access another tenant's patient records.");
    }
    return;
  }
  if (caller.sub !== userId) {
    throw new ForbiddenException("Cannot access another patient's records.");
  }
}

/** For staff-only writes (notes, files, visits) — a patient token is always rejected. */
export function requireStaffForTenant(req: AuthenticatedRequest, tenantId: string) {
  const caller = req.user!;
  if (!caller.tenantId) {
    throw new ForbiddenException("Only hospital staff can perform this action.");
  }
  if (caller.tenantId !== tenantId) {
    throw new ForbiddenException("Cannot access another tenant's patient records.");
  }
}
