import { Controller, Logger } from "@nestjs/common";
import { EventPattern, Payload } from "@nestjs/microservices";
import {
  PatientHospitalLinkedPayload, PatientHospitalUnlinkedPayload, Topics,
} from "../../../libs/contracts/src/events";
import { database, setTenantContext } from "../../../libs/common/src/database";

type InboundMessage<T> = { value?: T; key?: string };

/**
 * First consumer in this codebase that mutates domain state, not just logs —
 * so unlike notification-events.controller.ts's single untransacted query,
 * every handler here wraps the inbox dedupe insert and the domain update in
 * one transaction: if the inbox insert is a no-op (already processed), commit
 * and return without touching device_subscriptions.
 */
@Controller()
export class SubscriptionEventsController {
  private readonly logger = new Logger(SubscriptionEventsController.name);

  @EventPattern(Topics.patientHospitalLinked)
  async patientHospitalLinked(@Payload() message: InboundMessage<PatientHospitalLinkedPayload>) {
    const id = message.key?.toString();
    const payload = message.value;
    if (!id || !payload) return;

    const client = await database().connect();
    try {
      await client.query("BEGIN");
      const inserted = await client.query(
        "INSERT INTO inbox_events (id) VALUES ($1) ON CONFLICT DO NOTHING", [id],
      );
      if (!inserted.rowCount) { await client.query("COMMIT"); return; }

      await setTenantContext(client, payload.tenantId);
      await client.query(
        `INSERT INTO patient_hospital_link_cache (user_id, tenant_id) VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE SET tenant_id = EXCLUDED.tenant_id`,
        [payload.userId, payload.tenantId],
      );
      await client.query(
        "UPDATE device_subscriptions SET linked_tenant_id = $2, updated_at = NOW() WHERE user_id = $1 AND status = 'active'",
        [payload.userId, payload.tenantId],
      );
      await client.query("COMMIT");
      this.logger.log(`Linked patient ${payload.userId} to tenant ${payload.tenantId}`);
    } catch (error) {
      await client.query("ROLLBACK"); throw error;
    } finally { client.release(); }
  }

  @EventPattern(Topics.patientHospitalUnlinked)
  async patientHospitalUnlinked(@Payload() message: InboundMessage<PatientHospitalUnlinkedPayload>) {
    const id = message.key?.toString();
    const payload = message.value;
    if (!id || !payload) return;

    const client = await database().connect();
    try {
      await client.query("BEGIN");
      const inserted = await client.query(
        "INSERT INTO inbox_events (id) VALUES ($1) ON CONFLICT DO NOTHING", [id],
      );
      if (!inserted.rowCount) { await client.query("COMMIT"); return; }

      await setTenantContext(client, payload.tenantId);
      await client.query("DELETE FROM patient_hospital_link_cache WHERE user_id = $1", [payload.userId]);
      await client.query(
        "UPDATE device_subscriptions SET linked_tenant_id = NULL, updated_at = NOW() WHERE user_id = $1",
        [payload.userId],
      );
      await client.query("COMMIT");
      this.logger.log(`Unlinked patient ${payload.userId} from tenant ${payload.tenantId}`);
    } catch (error) {
      await client.query("ROLLBACK"); throw error;
    } finally { client.release(); }
  }
}
