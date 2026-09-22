import { Controller, Logger } from "@nestjs/common";
import { EventPattern, Payload } from "@nestjs/microservices";
import { HospitalRevokeAllLinksRequestedPayload, Topics } from "../../../libs/contracts/src/events";
import { database, setTenantContext } from "../../../libs/common/src/database";
import { unlinkPatientFromTenant } from "./hospital-link";

type InboundMessage<T> = { value?: T; key?: string };

/** Fans out a bulk "revoke all links" request (from apps/admin) into the same
 * per-patient unlink logic DELETE /users/:id/hospital-link already uses. */
@Controller()
export class RevokeAllLinksController {
  private readonly logger = new Logger(RevokeAllLinksController.name);

  @EventPattern(Topics.hospitalRevokeAllLinksRequested)
  async handle(@Payload() message: InboundMessage<HospitalRevokeAllLinksRequestedPayload>) {
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
      const linked = await client.query<{ user_id: string }>(
        "SELECT user_id FROM patient_hospital_links WHERE tenant_id = $1", [payload.tenantId],
      );
      for (const row of linked.rows) {
        await unlinkPatientFromTenant(client, row.user_id);
      }

      await client.query("COMMIT");
      this.logger.log(`Revoked ${linked.rows.length} patient link(s) for tenant ${payload.tenantId}`);
    } catch (error) {
      await client.query("ROLLBACK"); throw error;
    } finally { client.release(); }
  }
}
