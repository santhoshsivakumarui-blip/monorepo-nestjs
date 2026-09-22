import {
  BadRequestException, Body, Controller, ForbiddenException, Get, NotFoundException, Param, Post, Query, Req, UseGuards,
} from "@nestjs/common";
import { IsNotEmpty, IsString } from "class-validator";
import { randomUUID } from "crypto";
import {
  DomainEvent, SmsRequestedPayload, Topics,
} from "../../../libs/contracts/src/events";
import { database, queryAsTenant, setTenantContext } from "../../../libs/common/src/database";
import { enqueueOutbox } from "../../../libs/common/src/outbox";
import { generateCode, hashCode, verifyCode } from "../../../libs/common/src/otp";
import { JwtRolesGuard } from "../../../libs/common/src/oidc";

const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 5;

export class CreateAbhaRequestDto {
  @IsString() @IsNotEmpty() userId!: string;
  @IsString() @IsNotEmpty() abhaId!: string;
}

export class VerifyAbhaRequestDto {
  @IsString() @IsNotEmpty() code!: string;
}

interface AuthenticatedRequest { user?: { sub: string; tenantId?: string }; }

function requireTenantScope(req: AuthenticatedRequest, tenantId: string) {
  if (req.user!.tenantId && req.user!.tenantId !== tenantId) {
    throw new ForbiddenException("Cannot access another tenant's data.");
  }
}

/**
 * ABHA linking can be patient self-service or staff-assisted at reception.
 * Reimplemented here (not imported from apps/clinical-records/src/access.ts)
 * since cross-service code sharing isn't this codebase's pattern — returns the
 * tenantId to stamp on the request (null for patient self-service).
 */
async function resolveRequestContext(req: AuthenticatedRequest, userId: string): Promise<string | null> {
  if (req.user!.tenantId) {
    const { rows } = await queryAsTenant<{ tenant_id: string }>(
      req.user!.tenantId,
      "SELECT tenant_id FROM patient_hospital_links WHERE user_id = $1", [userId],
    );
    if (!rows[0] || rows[0].tenant_id !== req.user!.tenantId) {
      throw new ForbiddenException("Patient is not linked to your tenant.");
    }
    return req.user!.tenantId;
  }
  if (req.user!.sub !== userId) {
    throw new ForbiddenException("Cannot request ABHA linking for another patient.");
  }
  return null;
}

@Controller()
export class AbhaController {
  @Post("abha/requests")
  @UseGuards(JwtRolesGuard)
  async createRequest(@Body() body: CreateAbhaRequestDto, @Req() req: AuthenticatedRequest) {
    const tenantId = await resolveRequestContext(req, body.userId);

    const user = await database().query<{ phone: string | null }>("SELECT phone FROM users WHERE id = $1", [body.userId]);
    if (!user.rows[0]?.phone) throw new BadRequestException("Patient has no registered phone to send the ABHA OTP to.");

    const client = await database().connect();
    try {
      await client.query("BEGIN");
      if (tenantId) await setTenantContext(client, tenantId);
      const requestId = randomUUID();
      const code = generateCode();
      await client.query(
        `INSERT INTO abha_requests (id, user_id, tenant_id, abha_id, code_hash, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [requestId, body.userId, tenantId, body.abhaId, hashCode(code), new Date(Date.now() + CHALLENGE_TTL_MS)],
      );
      await client.query(
        `INSERT INTO abha_links (user_id, abha_id, status) VALUES ($1, $2, 'verifying')
         ON CONFLICT (user_id) DO UPDATE SET abha_id = EXCLUDED.abha_id, status = 'verifying'`,
        [body.userId, body.abhaId],
      );

      const smsPayload: SmsRequestedPayload = { to: user.rows[0].phone!, message: `Your ABHA verification code is ${code}. It expires in 5 minutes.` };
      const event: DomainEvent<SmsRequestedPayload> = {
        id: randomUUID(), type: Topics.smsRequested, occurredAt: new Date().toISOString(),
        correlationId: randomUUID(), payload: smsPayload,
      };
      await enqueueOutbox(client, event);
      await client.query("COMMIT");
      return { id: requestId, status: "pending" };
    } catch (error) {
      await client.query("ROLLBACK"); throw error;
    } finally { client.release(); }
  }

  @Post("abha/requests/:id/verify")
  @UseGuards(JwtRolesGuard)
  async verifyRequest(@Param("id") id: string, @Body() body: VerifyAbhaRequestDto) {
    // Committed immediately (no surrounding transaction), same attempts-first
    // shape as patient OTP / staff 2FA verify.
    const attempted = await database().query<{
      attempts: number; code_hash: string; expires_at: Date; user_id: string; tenant_id: string | null; abha_id: string;
    }>(
      `UPDATE abha_requests SET attempts = attempts + 1
       WHERE id = $1 AND status = 'pending'
       RETURNING attempts, code_hash, expires_at, user_id, tenant_id, abha_id`,
      [id],
    );
    const request = attempted.rows[0];
    if (!request) throw new NotFoundException("Invalid or already-resolved ABHA request.");
    if (request.attempts > MAX_ATTEMPTS) throw new ForbiddenException("Too many attempts.");
    if (new Date(request.expires_at).getTime() < Date.now()) throw new BadRequestException("Code expired.");
    if (!verifyCode(request.code_hash, body.code)) throw new BadRequestException("Incorrect code.");

    const client = await database().connect();
    try {
      await client.query("BEGIN");
      if (request.tenant_id) await setTenantContext(client, request.tenant_id);
      await client.query("UPDATE abha_requests SET status = 'verified' WHERE id = $1", [id]);
      await client.query(
        "UPDATE abha_links SET status = 'linked', linked_at = NOW() WHERE user_id = $1",
        [request.user_id],
      );
      if (request.tenant_id) {
        await client.query(
          "INSERT INTO abha_activity (id, tenant_id, user_id, what, status) VALUES ($1, $2, $3, $4, $5)",
          [randomUUID(), request.tenant_id, request.user_id, "Linked via OTP", "Linked"],
        );
      }
      await client.query("COMMIT");
      return { userId: request.user_id, status: "linked" };
    } catch (error) {
      await client.query("ROLLBACK"); throw error;
    } finally { client.release(); }
  }

  @Post("abha/requests/:id/cancel")
  @UseGuards(JwtRolesGuard)
  async cancelRequest(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    const existing = await database().query<{ tenant_id: string | null; status: string }>(
      "SELECT tenant_id, status FROM abha_requests WHERE id = $1", [id],
    );
    const request = existing.rows[0];
    if (!request) throw new NotFoundException("ABHA request not found.");
    if (!request.tenant_id) throw new ForbiddenException("Only a staff-initiated request can be cancelled here.");
    requireTenantScope(req, request.tenant_id);
    if (request.status !== "pending") throw new BadRequestException("Only a pending request can be cancelled.");

    await queryAsTenant(request.tenant_id, "UPDATE abha_requests SET status = 'cancelled' WHERE id = $1", [id]);
    return { id, status: "cancelled" };
  }

  @Post("abha/unlink")
  @UseGuards(JwtRolesGuard)
  async unlink(@Req() req: AuthenticatedRequest) {
    await database().query("UPDATE abha_links SET status = 'not_linked', abha_id = NULL WHERE user_id = $1", [req.user!.sub]);
    return { status: "not_linked" };
  }

  @Get("abha/mine")
  @UseGuards(JwtRolesGuard)
  async mine(@Req() req: AuthenticatedRequest) {
    const { rows } = await database().query(
      "SELECT abha_id, status, linked_at FROM abha_links WHERE user_id = $1", [req.user!.sub],
    );
    return rows[0] ?? { abha_id: null, status: "not_linked", linked_at: null };
  }

  @Get("abha/requests")
  @UseGuards(JwtRolesGuard)
  async listRequests(@Query("tenantId") tenantId: string | undefined, @Req() req: AuthenticatedRequest) {
    if (!tenantId) throw new BadRequestException("tenantId query parameter is required.");
    requireTenantScope(req, tenantId);
    const { rows } = await queryAsTenant(
      tenantId,
      "SELECT id, user_id, abha_id, status, created_at FROM abha_requests WHERE tenant_id = $1 AND status = 'pending' ORDER BY created_at DESC",
      [tenantId],
    );
    return rows;
  }

  @Get("abha/summary")
  @UseGuards(JwtRolesGuard)
  async summary(@Query("tenantId") tenantId: string | undefined, @Req() req: AuthenticatedRequest) {
    if (!tenantId) throw new BadRequestException("tenantId query parameter is required.");
    requireTenantScope(req, tenantId);
    const { rows } = await queryAsTenant<{ linked: string; total: string }>(
      tenantId,
      `SELECT COUNT(*) FILTER (WHERE al.status = 'linked') AS linked, COUNT(*) AS total
       FROM patient_hospital_links l LEFT JOIN abha_links al ON al.user_id = l.user_id
       WHERE l.tenant_id = $1`,
      [tenantId],
    );
    const linked = Number(rows[0].linked);
    const total = Number(rows[0].total);
    return { linked, total, notLinked: total - linked };
  }

  @Get("abha/activity")
  @UseGuards(JwtRolesGuard)
  async activity(@Query("tenantId") tenantId: string | undefined, @Req() req: AuthenticatedRequest) {
    if (!tenantId) throw new BadRequestException("tenantId query parameter is required.");
    requireTenantScope(req, tenantId);
    const { rows } = await queryAsTenant(
      tenantId,
      "SELECT id, user_id, what, status, created_at FROM abha_activity WHERE tenant_id = $1 ORDER BY created_at DESC",
      [tenantId],
    );
    return rows;
  }

  @Get("patients/:id/abha")
  @UseGuards(JwtRolesGuard)
  async patientAbha(@Param("id") id: string, @Query("tenantId") tenantId: string | undefined, @Req() req: AuthenticatedRequest) {
    if (!tenantId) throw new BadRequestException("tenantId query parameter is required.");
    requireTenantScope(req, tenantId);
    const link = await queryAsTenant<{ tenant_id: string }>(
      tenantId, "SELECT tenant_id FROM patient_hospital_links WHERE user_id = $1", [id],
    );
    if (!link.rows[0] || link.rows[0].tenant_id !== tenantId) {
      throw new ForbiddenException("Patient is not linked to this tenant.");
    }
    const { rows } = await database().query<{ abha_id: string | null; status: string; linked_at: Date | null }>(
      "SELECT abha_id, status, linked_at FROM abha_links WHERE user_id = $1", [id],
    );
    const record = rows[0] ?? { abha_id: null, status: "not_linked", linked_at: null };
    return {
      status: record.status,
      linkedAt: record.linked_at,
      maskedAbhaId: record.abha_id ? `••••-••••-${record.abha_id.slice(-4)}` : null,
    };
  }
}
