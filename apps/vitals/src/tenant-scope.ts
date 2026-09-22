import { ForbiddenException } from "@nestjs/common";
import { queryAsTenant } from "../../../libs/common/src/database";

export interface AuthenticatedRequest { user?: { sub: string; tenantId?: string }; }

/** Only tenant-unscoped (platform-level) tokens may query an arbitrary tenantId. */
export function requireTenantScope(req: AuthenticatedRequest, tenantId: string) {
  if (req.user!.tenantId && req.user!.tenantId !== tenantId) {
    throw new ForbiddenException("Cannot access another tenant's data.");
  }
}

export async function isLinked(userId: string, tenantId: string): Promise<boolean> {
  const { rows } = await queryAsTenant(
    tenantId,
    "SELECT 1 FROM patient_hospital_link_cache WHERE user_id = $1 AND tenant_id = $2",
    [userId, tenantId],
  );
  return rows.length > 0;
}
