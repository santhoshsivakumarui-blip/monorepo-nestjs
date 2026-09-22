import {
  BadRequestException, Body, Controller, Get, Headers, NotFoundException, Param, Post, Query, Req, UseGuards,
} from "@nestjs/common";
import { IsIn, IsNotEmpty, IsOptional, IsString } from "class-validator";
import { createHash, randomBytes, randomUUID } from "crypto";
import { PoolClient } from "pg";
import {
  DomainEvent, EmailRequestedPayload, Topics,
} from "../../../libs/contracts/src/events";
import { database, queryAsTenant, setTenantContext } from "../../../libs/common/src/database";
import { enqueueOutbox } from "../../../libs/common/src/outbox";
import {
  beginIdempotent, completeIdempotent, requestFingerprint,
} from "../../../libs/common/src/idempotency";
import { hashPassword } from "../../../libs/common/src/password";
import { JwtRolesGuard } from "../../../libs/common/src/oidc";
import { AuthenticatedRequest, requireTenantScope } from "./tenant-scope";
import { recordHospitalAuditEvent } from "./hospital-audit";

const ROLES = ["Doctor", "Nurse", "Reception", "Admin", "Auditor"] as const;
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Static — nothing in this codebase does permission-matrix-driven authorization; this mirrors what the mock UI actually displays. */
const PERMISSION_MATRIX = {
  roles: ROLES,
  permissions: [
    { key: "view_vitals", label: "View live vitals", roles: { Doctor: true, Nurse: true, Reception: false, Admin: true, Auditor: true } },
    { key: "manage_alerts", label: "Manage alert rules", roles: { Doctor: true, Nurse: false, Reception: false, Admin: true, Auditor: false } },
    { key: "manage_scripts", label: "Approve prescriptions", roles: { Doctor: true, Nurse: false, Reception: false, Admin: false, Auditor: false } },
    { key: "manage_roster", label: "Manage roster & links", roles: { Doctor: false, Nurse: false, Reception: true, Admin: true, Auditor: false } },
    { key: "manage_staff", label: "Invite & manage staff", roles: { Doctor: false, Nurse: false, Reception: false, Admin: true, Auditor: false } },
    { key: "manage_settings", label: "Edit hospital settings", roles: { Doctor: false, Nurse: false, Reception: false, Admin: true, Auditor: false } },
    { key: "view_audit_log", label: "View audit log", roles: { Doctor: false, Nurse: false, Reception: false, Admin: true, Auditor: true } },
  ],
};

export class InviteStaffDto {
  @IsString() @IsNotEmpty() tenantId!: string;
  @IsString() @IsNotEmpty() email!: string;
  @IsString() @IsNotEmpty() fullName!: string;
  @IsIn(ROLES) role!: (typeof ROLES)[number];
  @IsOptional() @IsString() department?: string;
}

export class AcceptInviteDto {
  @IsString() @IsNotEmpty() password!: string;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

async function sendInvite(client: PoolClient, staffId: string, email: string) {
  const token = randomBytes(24).toString("hex");
  await client.query(
    "INSERT INTO staff_invites (token_hash, staff_id, expires_at) VALUES ($1, $2, $3)",
    [hashToken(token), staffId, new Date(Date.now() + INVITE_TTL_MS)],
  );
  const emailPayload: EmailRequestedPayload = {
    to: email, subject: "You've been invited to Zentinel",
    message: `Accept your invite with this token: ${token} (expires in 7 days).`,
  };
  const event: DomainEvent<EmailRequestedPayload> = {
    id: randomUUID(), type: Topics.emailRequested, occurredAt: new Date().toISOString(),
    correlationId: randomUUID(), payload: emailPayload,
  };
  await enqueueOutbox(client, event);
}

@Controller()
export class StaffController {
  @Get("staff")
  @UseGuards(JwtRolesGuard)
  async list(@Query("tenantId") tenantId: string | undefined, @Req() req: AuthenticatedRequest) {
    if (!tenantId) throw new BadRequestException("tenantId query parameter is required.");
    requireTenantScope(req, tenantId);
    const { rows } = await queryAsTenant(
      tenantId,
      `SELECT id, email, full_name, role, department, status, last_active_at
       FROM tenant_staff WHERE tenant_id = $1 AND status != 'removed' ORDER BY full_name`,
      [tenantId],
    );
    return rows;
  }

  @Post("staff/invite")
  @UseGuards(JwtRolesGuard)
  async invite(
    @Body() body: InviteStaffDto,
    @Headers("idempotency-key") key: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    requireTenantScope(req, body.tenantId);
    const client = await database().connect();
    try {
      await client.query("BEGIN");
      await setTenantContext(client, body.tenantId);
      const replay = await beginIdempotent(client, key, requestFingerprint("POST", "/staff/invite", body));
      if (replay) { await client.query("COMMIT"); return replay; }

      const staffId = randomUUID();
      await client.query(
        `INSERT INTO tenant_staff (id, tenant_id, email, password_hash, full_name, role, department, status)
         VALUES ($1, $2, $3, NULL, $4, $5, $6, 'invited')`,
        [staffId, body.tenantId, body.email, body.fullName, body.role, body.department ?? null],
      );
      await sendInvite(client, staffId, body.email);
      await recordHospitalAuditEvent(client, {
        tenantId: body.tenantId, actorId: req.user!.sub, actorLabel: req.user!.sub,
        action: "STAFF_INVITED", target: body.email, category: "Roles",
      });

      const response = { id: staffId, email: body.email, fullName: body.fullName, role: body.role, status: "invited" };
      await completeIdempotent(client, key!, response);
      await client.query("COMMIT");
      return response;
    } catch (error) {
      await client.query("ROLLBACK"); throw error;
    } finally { client.release(); }
  }

  @Post("staff/invite/:token/accept")
  async acceptInvite(@Param("token") token: string, @Body() body: AcceptInviteDto) {
    const client = await database().connect();
    try {
      await client.query("BEGIN");
      const existing = await client.query<{ staff_id: string; expires_at: Date; consumed_at: Date | null }>(
        "SELECT staff_id, expires_at, consumed_at FROM staff_invites WHERE token_hash = $1 FOR UPDATE",
        [hashToken(token)],
      );
      const invite = existing.rows[0];
      if (!invite || invite.consumed_at) throw new NotFoundException("Invite not found or already used.");
      if (new Date(invite.expires_at).getTime() < Date.now()) throw new BadRequestException("Invite has expired.");

      await client.query(
        "UPDATE tenant_staff SET password_hash = $2, status = 'active' WHERE id = $1",
        [invite.staff_id, hashPassword(body.password)],
      );
      await client.query("UPDATE staff_invites SET consumed_at = NOW() WHERE token_hash = $1", [hashToken(token)]);
      await client.query("COMMIT");
      return { staffId: invite.staff_id, accepted: true };
    } catch (error) {
      await client.query("ROLLBACK"); throw error;
    } finally { client.release(); }
  }

  @Post("staff/:id/resend-invite")
  @UseGuards(JwtRolesGuard)
  async resendInvite(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    const existing = await database().query<{ tenant_id: string; email: string; status: string }>(
      "SELECT tenant_id, email, status FROM tenant_staff WHERE id = $1", [id],
    );
    const staff = existing.rows[0];
    if (!staff) throw new NotFoundException("Staff member not found.");
    requireTenantScope(req, staff.tenant_id);
    if (staff.status !== "invited") throw new BadRequestException("Only a pending invite can be resent.");

    const client = await database().connect();
    try {
      await client.query("BEGIN");
      await sendInvite(client, id, staff.email);
      await client.query("COMMIT");
      return { id, accepted: true };
    } catch (error) {
      await client.query("ROLLBACK"); throw error;
    } finally { client.release(); }
  }

  @Post("staff/:id/suspend")
  @UseGuards(JwtRolesGuard)
  async suspend(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    return this.setStatus(id, "suspended", "STAFF_SUSPENDED", req);
  }

  @Post("staff/:id/reinstate")
  @UseGuards(JwtRolesGuard)
  async reinstate(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    return this.setStatus(id, "active", "STAFF_REINSTATED", req);
  }

  @Post("staff/:id/remove")
  @UseGuards(JwtRolesGuard)
  async remove(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    return this.setStatus(id, "removed", "STAFF_REMOVED", req);
  }

  private async setStatus(id: string, status: string, action: string, req: AuthenticatedRequest) {
    const client = await database().connect();
    try {
      await client.query("BEGIN");
      const existing = await client.query<{ tenant_id: string; email: string }>(
        "SELECT tenant_id, email FROM tenant_staff WHERE id = $1 FOR UPDATE", [id],
      );
      const staff = existing.rows[0];
      if (!staff) throw new NotFoundException("Staff member not found.");
      requireTenantScope(req, staff.tenant_id);
      await setTenantContext(client, staff.tenant_id);

      await client.query("UPDATE tenant_staff SET status = $2 WHERE id = $1", [id, status]);
      await recordHospitalAuditEvent(client, {
        tenantId: staff.tenant_id, actorId: req.user!.sub, actorLabel: req.user!.sub,
        action, target: staff.email, category: "Roles",
      });
      await client.query("COMMIT");
      return { id, status };
    } catch (error) {
      await client.query("ROLLBACK"); throw error;
    } finally { client.release(); }
  }

  @Get("roles/permissions")
  @UseGuards(JwtRolesGuard)
  permissions() {
    return PERMISSION_MATRIX;
  }
}
