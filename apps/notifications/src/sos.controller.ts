import {
  BadRequestException, Body, Controller, ForbiddenException, Get, NotFoundException, Param, Post, Query, Req, UseGuards,
} from "@nestjs/common";
import { IsArray, IsOptional, IsString } from "class-validator";
import { randomUUID } from "crypto";
import { DomainEvent, SmsRequestedPayload, Topics } from "../../../libs/contracts/src/events";
import { database, queryAsTenant, setTenantContext } from "../../../libs/common/src/database";
import { enqueueOutbox } from "../../../libs/common/src/outbox";
import { JwtRolesGuard } from "../../../libs/common/src/oidc";

export class TriggerSosDto {
  @IsOptional() @IsString() tenantId?: string;
  @IsOptional() @IsString() emergencyContactName?: string;
  @IsOptional() @IsString() emergencyContactPhone?: string;
  @IsOptional() @IsArray() vitalsSnapshot?: unknown[];
}

interface AuthenticatedRequest { user?: { sub: string; tenantId?: string }; }

@Controller()
export class SosController {
  @Post("sos/trigger")
  @UseGuards(JwtRolesGuard)
  async trigger(@Body() body: TriggerSosDto, @Req() req: AuthenticatedRequest) {
    const id = randomUUID();
    const client = await database().connect();
    try {
      await client.query("BEGIN");
      if (body.tenantId) await setTenantContext(client, body.tenantId);
      await client.query(
        `INSERT INTO sos_alerts (id, user_id, tenant_id, emergency_contact_name, emergency_contact_phone, vitals_snapshot)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          id, req.user!.sub, body.tenantId ?? null, body.emergencyContactName ?? null,
          body.emergencyContactPhone ?? null, body.vitalsSnapshot ? JSON.stringify(body.vitalsSnapshot) : null,
        ],
      );

      if (body.emergencyContactPhone) {
        const smsPayload: SmsRequestedPayload = {
          to: body.emergencyContactPhone,
          message: `Zentinel emergency alert: your contact has triggered an SOS and needs help.`,
        };
        const event: DomainEvent<SmsRequestedPayload> = {
          id: randomUUID(), type: Topics.smsRequested, occurredAt: new Date().toISOString(),
          correlationId: randomUUID(), payload: smsPayload,
        };
        await enqueueOutbox(client, event);
      }

      await client.query("COMMIT");
      return { id, status: "active" };
    } catch (error) {
      await client.query("ROLLBACK"); throw error;
    } finally { client.release(); }
  }

  @Post("sos/:id/cancel")
  @UseGuards(JwtRolesGuard)
  async cancel(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    const existing = await database().query<{ user_id: string; tenant_id: string | null }>(
      "SELECT user_id, tenant_id FROM sos_alerts WHERE id = $1", [id],
    );
    const alert = existing.rows[0];
    if (!alert) throw new NotFoundException("SOS alert not found.");
    if (alert.user_id !== req.user!.sub) throw new ForbiddenException("Cannot cancel another patient's alert.");

    const sql = "UPDATE sos_alerts SET status = 'cancelled', resolved_at = NOW() WHERE id = $1";
    if (alert.tenant_id) await queryAsTenant(alert.tenant_id, sql, [id]);
    else await database().query(sql, [id]);
    return { id, status: "cancelled" };
  }

  @Get("sos/active")
  @UseGuards(JwtRolesGuard)
  async active(@Query("tenantId") tenantId: string | undefined, @Req() req: AuthenticatedRequest) {
    if (!tenantId) throw new BadRequestException("tenantId query parameter is required.");
    if (req.user!.tenantId && req.user!.tenantId !== tenantId) {
      throw new ForbiddenException("Cannot view another tenant's alerts.");
    }
    const { rows } = await queryAsTenant(
      tenantId,
      "SELECT id, user_id, emergency_contact_name, vitals_snapshot, created_at FROM sos_alerts WHERE tenant_id = $1 AND status = 'active' ORDER BY created_at DESC",
      [tenantId],
    );
    return rows;
  }
}
