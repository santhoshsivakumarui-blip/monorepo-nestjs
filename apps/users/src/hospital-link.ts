import { PoolClient } from "pg";
import { randomUUID } from "crypto";
import {
  DomainEvent, PatientHospitalLinkedPayload, PatientHospitalUnlinkedPayload, Topics,
} from "../../../libs/contracts/src/events";
import { enqueueOutbox } from "../../../libs/common/src/outbox";
import { setTenantContext } from "../../../libs/common/src/database";

/**
 * Shared by HospitalLinkController.link() (direct code entry) and
 * LinkRequestsController.redeem() (staff-issued invite) — both converge on the
 * same underlying link, just reached via a different front door. Runs inside
 * the caller's existing transaction.
 */
export async function linkPatientToTenant(client: PoolClient, userId: string, tenantId: string) {
  const payload: PatientHospitalLinkedPayload = { userId, tenantId };
  const event: DomainEvent<PatientHospitalLinkedPayload> = {
    id: randomUUID(), type: Topics.patientHospitalLinked, occurredAt: new Date().toISOString(),
    correlationId: randomUUID(), payload,
  };

  await setTenantContext(client, tenantId);
  await client.query(
    `INSERT INTO patient_hospital_links (user_id, tenant_id) VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE SET tenant_id = EXCLUDED.tenant_id, linked_at = NOW()`,
    [userId, tenantId],
  );
  await enqueueOutbox(client, event);

  return payload;
}

/**
 * Shared by HospitalLinkController.unlink() (patient-initiated) and the
 * hospitalRevokeAllLinksRequested consumer (staff-initiated, bulk). Returns
 * null if the patient wasn't linked to begin with (a no-op, not an error).
 * Runs inside the caller's existing transaction.
 */
export async function unlinkPatientFromTenant(client: PoolClient, userId: string): Promise<PatientHospitalUnlinkedPayload | null> {
  const existing = await client.query<{ tenant_id: string }>(
    "SELECT tenant_id FROM patient_hospital_links WHERE user_id = $1 FOR UPDATE", [userId],
  );
  const tenantId = existing.rows[0]?.tenant_id;
  if (!tenantId) return null;

  const payload: PatientHospitalUnlinkedPayload = { userId, tenantId };
  const event: DomainEvent<PatientHospitalUnlinkedPayload> = {
    id: randomUUID(), type: Topics.patientHospitalUnlinked, occurredAt: new Date().toISOString(),
    correlationId: randomUUID(), payload,
  };

  await setTenantContext(client, tenantId);
  await client.query("DELETE FROM patient_hospital_links WHERE user_id = $1", [userId]);
  await enqueueOutbox(client, event);

  return payload;
}
