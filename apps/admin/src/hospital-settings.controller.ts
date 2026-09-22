import {
  BadRequestException, Body, Controller, Get, NotFoundException, Param, Patch, Post, Req, UseGuards,
} from "@nestjs/common";
import { IsBoolean, IsInt, IsOptional, IsString } from "class-validator";
import { randomUUID } from "crypto";
import { DomainEvent, HospitalRevokeAllLinksRequestedPayload, Topics } from "../../../libs/contracts/src/events";
import { database, queryAsTenant, setTenantContext } from "../../../libs/common/src/database";
import { enqueueOutbox } from "../../../libs/common/src/outbox";
import { JwtRolesGuard } from "../../../libs/common/src/oidc";
import { AuthenticatedRequest, requireTenantScope } from "./tenant-scope";
import { recordHospitalAuditEvent } from "./hospital-audit";
import { generateLinkingCode } from "./linking-code";

export class UpdateHospitalProfileDto {
  @IsOptional() @IsString() emergencyPhone?: string;
  @IsOptional() @IsBoolean() requireMfa?: boolean;
  @IsOptional() @IsInt() auditRetentionYears?: number;
}

export class UpdateMonitoringDefaultDto {
  @IsString() key!: string;
  @IsBoolean() enabled!: boolean;
  @IsOptional() @IsString() value?: string;
}

@Controller()
export class HospitalSettingsController {
  @Get("hospitals/by-linking-code/:code")
  @UseGuards(JwtRolesGuard)
  async byLinkingCode(@Param("code") code: string) {
    const { rows } = await database().query<{ tenant_id: string; legal_name: string }>(
      `SELECT hs.tenant_id, t.legal_name FROM hospital_settings hs
       JOIN tenants t ON t.id = hs.tenant_id WHERE hs.linking_code = $1`,
      [code],
    );
    if (!rows[0]) throw new NotFoundException("Linking code not recognised.");
    return { tenantId: rows[0].tenant_id, legalName: rows[0].legal_name };
  }

  @Post("hospitals/:id/linking-code/rotate")
  @UseGuards(JwtRolesGuard)
  async rotateLinkingCode(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    requireTenantScope(req, id);
    const newCode = generateLinkingCode();
    const client = await database().connect();
    try {
      await client.query("BEGIN");
      await setTenantContext(client, id);
      await client.query("UPDATE hospital_settings SET linking_code = $2, updated_at = NOW() WHERE tenant_id = $1", [id, newCode]);
      await recordHospitalAuditEvent(client, {
        tenantId: id, actorId: req.user!.sub, actorLabel: req.user!.sub, action: "LINKING_CODE_ROTATED", category: "Settings",
      });
      await client.query("COMMIT");
      return { tenantId: id, linkingCode: newCode };
    } catch (error) {
      await client.query("ROLLBACK"); throw error;
    } finally { client.release(); }
  }

  @Get("hospitals/:id/profile")
  @UseGuards(JwtRolesGuard)
  async getProfile(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    requireTenantScope(req, id);
    const { rows } = await queryAsTenant(
      id,
      `SELECT t.legal_name, t.plan, hs.linking_code, hs.emergency_phone, hs.require_mfa, hs.audit_retention_years
       FROM tenants t JOIN hospital_settings hs ON hs.tenant_id = t.id WHERE t.id = $1`,
      [id],
    );
    if (!rows[0]) throw new NotFoundException("Hospital not found.");
    return rows[0];
  }

  @Patch("hospitals/:id/profile")
  @UseGuards(JwtRolesGuard)
  async updateProfile(@Param("id") id: string, @Body() body: UpdateHospitalProfileDto, @Req() req: AuthenticatedRequest) {
    requireTenantScope(req, id);
    const client = await database().connect();
    try {
      await client.query("BEGIN");
      await setTenantContext(client, id);
      await client.query(
        `UPDATE hospital_settings SET
           emergency_phone = COALESCE($2, emergency_phone),
           require_mfa = COALESCE($3, require_mfa),
           audit_retention_years = COALESCE($4, audit_retention_years),
           updated_at = NOW()
         WHERE tenant_id = $1`,
        [id, body.emergencyPhone ?? null, body.requireMfa ?? null, body.auditRetentionYears ?? null],
      );
      await recordHospitalAuditEvent(client, {
        tenantId: id, actorId: req.user!.sub, actorLabel: req.user!.sub, action: "HOSPITAL_PROFILE_UPDATED", category: "Settings",
      });
      await client.query("COMMIT");
      return { tenantId: id, accepted: true };
    } catch (error) {
      await client.query("ROLLBACK"); throw error;
    } finally { client.release(); }
  }

  @Get("hospitals/:id/monitoring-defaults")
  @UseGuards(JwtRolesGuard)
  async getMonitoringDefaults(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    requireTenantScope(req, id);
    const { rows } = await queryAsTenant(
      id,
      "SELECT key, enabled, value FROM hospital_monitoring_defaults WHERE tenant_id = $1 ORDER BY key",
      [id],
    );
    return rows;
  }

  @Patch("hospitals/:id/monitoring-defaults")
  @UseGuards(JwtRolesGuard)
  async updateMonitoringDefault(@Param("id") id: string, @Body() body: UpdateMonitoringDefaultDto, @Req() req: AuthenticatedRequest) {
    requireTenantScope(req, id);
    const client = await database().connect();
    try {
      await client.query("BEGIN");
      await setTenantContext(client, id);
      await client.query(
        `INSERT INTO hospital_monitoring_defaults (tenant_id, key, enabled, value)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (tenant_id, key) DO UPDATE SET enabled = EXCLUDED.enabled, value = EXCLUDED.value`,
        [id, body.key, body.enabled, body.value ?? null],
      );
      await recordHospitalAuditEvent(client, {
        tenantId: id, actorId: req.user!.sub, actorLabel: req.user!.sub,
        action: "MONITORING_DEFAULT_UPDATED", target: body.key, category: "Settings",
      });
      await client.query("COMMIT");
      return { tenantId: id, key: body.key, enabled: body.enabled, value: body.value ?? null };
    } catch (error) {
      await client.query("ROLLBACK"); throw error;
    } finally { client.release(); }
  }

  @Get("hospitals/:id/integrations")
  @UseGuards(JwtRolesGuard)
  async getIntegrations(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    requireTenantScope(req, id);
    const { rows } = await queryAsTenant(
      id,
      "SELECT integration_key, connected FROM hospital_integrations WHERE tenant_id = $1",
      [id],
    );
    return rows;
  }

  @Post("hospitals/:id/integrations/:key/connect")
  @UseGuards(JwtRolesGuard)
  async connectIntegration(@Param("id") id: string, @Param("key") key: string, @Req() req: AuthenticatedRequest) {
    return this.setIntegration(id, key, true, req);
  }

  @Post("hospitals/:id/integrations/:key/disconnect")
  @UseGuards(JwtRolesGuard)
  async disconnectIntegration(@Param("id") id: string, @Param("key") key: string, @Req() req: AuthenticatedRequest) {
    return this.setIntegration(id, key, false, req);
  }

  private async setIntegration(tenantId: string, key: string, connected: boolean, req: AuthenticatedRequest) {
    requireTenantScope(req, tenantId);
    if (!key) throw new BadRequestException("An integration key is required.");
    const client = await database().connect();
    try {
      await client.query("BEGIN");
      await setTenantContext(client, tenantId);
      await client.query(
        `INSERT INTO hospital_integrations (tenant_id, integration_key, connected) VALUES ($1, $2, $3)
         ON CONFLICT (tenant_id, integration_key) DO UPDATE SET connected = EXCLUDED.connected`,
        [tenantId, key, connected],
      );
      await recordHospitalAuditEvent(client, {
        tenantId, actorId: req.user!.sub, actorLabel: req.user!.sub,
        action: connected ? "INTEGRATION_CONNECTED" : "INTEGRATION_DISCONNECTED", target: key, category: "Settings",
      });
      await client.query("COMMIT");
      return { tenantId, integrationKey: key, connected };
    } catch (error) {
      await client.query("ROLLBACK"); throw error;
    } finally { client.release(); }
  }

  @Post("hospitals/:id/revoke-all-links")
  @UseGuards(JwtRolesGuard)
  async revokeAllLinks(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    requireTenantScope(req, id);
    const event: DomainEvent<HospitalRevokeAllLinksRequestedPayload> = {
      id: randomUUID(), type: Topics.hospitalRevokeAllLinksRequested, occurredAt: new Date().toISOString(),
      correlationId: randomUUID(), payload: { tenantId: id },
    };

    const client = await database().connect();
    try {
      await client.query("BEGIN");
      await setTenantContext(client, id);
      await enqueueOutbox(client, event);
      await recordHospitalAuditEvent(client, {
        tenantId: id, actorId: req.user!.sub, actorLabel: req.user!.sub, action: "ALL_LINKS_REVOKE_REQUESTED", category: "Settings",
      });
      await client.query("COMMIT");
      return { tenantId: id, accepted: true };
    } catch (error) {
      await client.query("ROLLBACK"); throw error;
    } finally { client.release(); }
  }
}
