import {
  BadRequestException, Body, Controller, ForbiddenException, Get, Headers, NotFoundException, Param, Post, Query, Req, UseGuards,
} from "@nestjs/common";
import { IsIn, IsNotEmpty, IsString } from "class-validator";
import { randomBytes, randomUUID } from "crypto";
import { database, queryAsTenant, setTenantContext } from "../../../libs/common/src/database";
import {
  beginIdempotent, completeIdempotent, requestFingerprint,
} from "../../../libs/common/src/idempotency";
import { JwtRolesGuard } from "../../../libs/common/src/oidc";
import { linkPatientToTenant } from "./hospital-link";

const ORIGINS = ["qr_desk", "invite_link"] as const;

export class CreateLinkRequestDto {
  @IsString() @IsNotEmpty() tenantId!: string;
  @IsIn(ORIGINS) origin!: (typeof ORIGINS)[number];
}

export class RedeemLinkRequestDto {
  @IsString() @IsNotEmpty() inviteCode!: string;
}

interface AuthenticatedRequest { user?: { sub: string; tenantId?: string }; }

function requireTenantScope(req: AuthenticatedRequest, tenantId: string) {
  if (req.user!.tenantId && req.user!.tenantId !== tenantId) {
    throw new ForbiddenException("Cannot access another tenant's link requests.");
  }
}

@Controller("link-requests")
export class LinkRequestsController {
  @Get()
  @UseGuards(JwtRolesGuard)
  async list(@Query("tenantId") tenantId: string | undefined, @Req() req: AuthenticatedRequest) {
    if (!tenantId) throw new BadRequestException("tenantId query parameter is required.");
    requireTenantScope(req, tenantId);
    const { rows } = await queryAsTenant(
      tenantId,
      `SELECT id, origin, invite_code, status, created_at FROM link_requests
       WHERE tenant_id = $1 AND status = 'pending' ORDER BY created_at DESC`,
      [tenantId],
    );
    return rows;
  }

  @Post()
  @UseGuards(JwtRolesGuard)
  async create(
    @Body() body: CreateLinkRequestDto,
    @Headers("idempotency-key") key: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    requireTenantScope(req, body.tenantId);
    const client = await database().connect();
    try {
      await client.query("BEGIN");
      await setTenantContext(client, body.tenantId);
      const replay = await beginIdempotent(client, key, requestFingerprint("POST", "/link-requests", body));
      if (replay) { await client.query("COMMIT"); return replay; }

      const id = randomUUID();
      const inviteCode = randomBytes(6).toString("hex").toUpperCase();
      await client.query(
        "INSERT INTO link_requests (id, tenant_id, origin, invite_code) VALUES ($1, $2, $3, $4)",
        [id, body.tenantId, body.origin, inviteCode],
      );

      const response = { id, tenantId: body.tenantId, origin: body.origin, inviteCode, status: "pending" };
      await completeIdempotent(client, key!, response);
      await client.query("COMMIT");
      return response;
    } catch (error) {
      await client.query("ROLLBACK"); throw error;
    } finally { client.release(); }
  }

  @Post(":id/revoke")
  @UseGuards(JwtRolesGuard)
  async revoke(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    const existing = await database().query<{ tenant_id: string; status: string }>(
      "SELECT tenant_id, status FROM link_requests WHERE id = $1", [id],
    );
    const request = existing.rows[0];
    if (!request) throw new NotFoundException("Link request not found.");
    requireTenantScope(req, request.tenant_id);
    if (request.status !== "pending") {
      throw new BadRequestException("Only a pending link request can be revoked.");
    }

    await queryAsTenant(
      request.tenant_id,
      "UPDATE link_requests SET status = 'revoked', resolved_at = NOW() WHERE id = $1", [id],
    );
    return { id, accepted: true };
  }

  /** Self-only: a patient redeems a staff-issued invite, linking immediately (redemption is the approval — see plan). */
  @Post("redeem")
  @UseGuards(JwtRolesGuard)
  async redeem(
    @Body() body: RedeemLinkRequestDto,
    @Headers("idempotency-key") key: string | undefined,
    @Req() req: { user?: { sub: string } },
  ) {
    const userId = req.user!.sub;
    const client = await database().connect();
    try {
      await client.query("BEGIN");
      const replay = await beginIdempotent<{ userId: string; tenantId: string }>(
        client, key, requestFingerprint("POST", "/link-requests/redeem", body),
      );
      if (replay) { await client.query("COMMIT"); return replay; }

      const existing = await client.query<{ id: string; tenant_id: string; status: string }>(
        "SELECT id, tenant_id, status FROM link_requests WHERE invite_code = $1 FOR UPDATE",
        [body.inviteCode],
      );
      const request = existing.rows[0];
      if (!request || request.status !== "pending") {
        throw new NotFoundException("Invite code not found or already used.");
      }

      const payload = await linkPatientToTenant(client, userId, request.tenant_id);
      await client.query(
        "UPDATE link_requests SET status = 'redeemed', user_id = $2, resolved_at = NOW() WHERE id = $1",
        [request.id, userId],
      );
      await completeIdempotent(client, key!, payload);
      await client.query("COMMIT");
      return payload;
    } catch (error) {
      await client.query("ROLLBACK"); throw error;
    } finally { client.release(); }
  }
}
