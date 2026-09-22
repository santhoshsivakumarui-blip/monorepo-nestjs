import { Controller, Logger } from "@nestjs/common";
import { EventPattern, Payload } from "@nestjs/microservices";
import {
  PatientHospitalLinkedPayload, PatientHospitalUnlinkedPayload, Topics,
} from "../../../libs/contracts/src/events";
import { database, setTenantContext } from "../../../libs/common/src/database";

const CONSENT_CATEGORIES = ["heart_rate", "spo2", "blood_pressure", "temperature", "hrv", "activity"];

type InboundMessage<T> = { value?: T; key?: string };

/** Mirrors apps/subscriptions/src/subscription-events.controller.ts's inbox+domain-mutation-in-one-transaction pattern. */
@Controller()
export class VitalsLinkEventsController {
  private readonly logger = new Logger(VitalsLinkEventsController.name);

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
      // Patient starts fully shared on link, matching the existing care-hub UI's
      // default state; they can dial individual categories back afterward.
      for (const category of CONSENT_CATEGORIES) {
        await client.query(
          `INSERT INTO vitals_consent (user_id, tenant_id, category, enabled)
           VALUES ($1, $2, $3, true) ON CONFLICT (user_id, tenant_id, category) DO NOTHING`,
          [payload.userId, payload.tenantId, category],
        );
      }
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
      await client.query("COMMIT");
      this.logger.log(`Unlinked patient ${payload.userId} from tenant ${payload.tenantId}`);
    } catch (error) {
      await client.query("ROLLBACK"); throw error;
    } finally { client.release(); }
  }
}
