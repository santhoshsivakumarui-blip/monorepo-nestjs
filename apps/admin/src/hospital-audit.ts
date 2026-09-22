import { PoolClient } from "pg";
import { randomUUID } from "crypto";
import { setTenantContext } from "../../../libs/common/src/database";

export type HospitalAuditCategory = "Consent" | "Access" | "Roles" | "Settings" | "Auth";

/**
 * Distinct from admin.ts's recordAuditEvent (platform-level, admin_users actors,
 * admin_audit_events) — this is the hospital-facing audit trail (tenant_staff
 * actors, hospital_audit_events), what the clinic app's Admin/Audit page reads.
 * Wired into staff/roles/settings/auth actions this pass; not retroactively
 * added to every existing endpoint — see the plan's named partial-coverage note.
 */
export async function recordHospitalAuditEvent(
  client: PoolClient,
  params: {
    tenantId: string;
    actorId: string | null;
    actorLabel: string;
    action: string;
    target?: string;
    category: HospitalAuditCategory;
  },
) {
  // Redundant with each caller already setting context for its own transaction
  // (see e.g. hospital-settings.controller.ts) — kept as a defensive default
  // so a future caller that forgets to still gets this write correctly scoped.
  await setTenantContext(client, params.tenantId);
  await client.query(
    `INSERT INTO hospital_audit_events (id, tenant_id, actor_id, actor_label, action, target, category)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [randomUUID(), params.tenantId, params.actorId, params.actorLabel, params.action, params.target ?? null, params.category],
  );
}
