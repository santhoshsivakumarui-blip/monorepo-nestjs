import { UnauthorizedException } from "@nestjs/common";
import { PoolClient } from "pg";

/** The caller's JWT `sub` must match an active admin_users.id — see README for bootstrapping the first admin. */
export async function resolveAdminId(
  client: PoolClient,
  sub: string,
): Promise<string> {
  const result = await client.query<{ id: string; status: string }>(
    "SELECT id, status FROM admin_users WHERE id = $1",
    [sub],
  );
  const admin = result.rows[0];
  if (!admin || admin.status !== "active") {
    throw new UnauthorizedException(
      "No active admin_users record for this identity.",
    );
  }
  return admin.id;
}

export async function recordAuditEvent(
  client: PoolClient,
  params: {
    adminId: string | null;
    action: string;
    targetTenantId?: string;
    ipAddress: string;
    payload?: unknown;
    /** 'SELF_SERVICE' for actions with no admin_users actor, e.g. public hospital registration. */
    actorType?: "PLATFORM_ADMIN" | "SELF_SERVICE";
  },
) {
  await client.query(
    "INSERT INTO admin_audit_events (admin_id, action, target_tenant_id, ip_address, payload, actor_type) VALUES ($1, $2, $3, $4, $5, $6)",
    [
      params.adminId,
      params.action,
      params.targetTenantId ?? null,
      params.ipAddress,
      params.payload ? JSON.stringify(params.payload) : null,
      params.actorType ?? "PLATFORM_ADMIN",
    ],
  );
}
