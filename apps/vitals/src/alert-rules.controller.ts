import {
  BadRequestException, Body, Controller, ForbiddenException, Get, Headers, NotFoundException, Param, Patch, Post, Put, Query, Req, UseGuards,
} from "@nestjs/common";
import { IsBoolean, IsIn, IsNumber, IsNotEmpty, IsOptional, IsString } from "class-validator";
import { randomUUID } from "crypto";
import { database, queryAsTenant, setTenantContext, withTenantTransaction } from "../../../libs/common/src/database";
import {
  beginIdempotent, completeIdempotent, requestFingerprint,
} from "../../../libs/common/src/idempotency";
import { JwtRolesGuard } from "../../../libs/common/src/oidc";
import { Comparator, resolveEffectiveRule } from "./alert-evaluation";
import { AuthenticatedRequest, isLinked, requireTenantScope } from "./tenant-scope";

const COMPARATORS: Comparator[] = ["gt", "lt"];

export class CreateAlertRuleDto {
  @IsString() @IsNotEmpty() tenantId!: string;
  @IsString() @IsNotEmpty() metric!: string;
  @IsIn(COMPARATORS) comparator!: Comparator;
  @IsNumber() threshold!: number;
}

export class UpdateAlertRuleDto {
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsNumber() threshold?: number;
}

export class UpsertPatientAlertOverrideDto {
  @IsString() @IsNotEmpty() userId!: string;
  @IsString() @IsNotEmpty() tenantId!: string;
  @IsString() @IsNotEmpty() metric!: string;
  @IsIn(COMPARATORS) comparator!: Comparator;
  @IsNumber() threshold!: number;
  @IsBoolean() enabled!: boolean;
}

@Controller("alert-rules")
export class AlertRulesController {
  @Get()
  @UseGuards(JwtRolesGuard)
  async list(@Query("tenantId") tenantId: string | undefined, @Req() req: AuthenticatedRequest) {
    if (!tenantId) throw new BadRequestException("tenantId query parameter is required.");
    requireTenantScope(req, tenantId);
    const { rows } = await queryAsTenant(
      tenantId,
      "SELECT id, metric, comparator, threshold, enabled, updated_at FROM alert_rules WHERE tenant_id = $1 ORDER BY metric",
      [tenantId],
    );
    return rows;
  }

  @Post()
  @UseGuards(JwtRolesGuard)
  async create(
    @Body() body: CreateAlertRuleDto,
    @Headers("idempotency-key") key: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    requireTenantScope(req, body.tenantId);
    const client = await database().connect();
    try {
      await client.query("BEGIN");
      await setTenantContext(client, body.tenantId);
      const replay = await beginIdempotent(client, key, requestFingerprint("POST", "/alert-rules", body));
      if (replay) { await client.query("COMMIT"); return replay; }

      const id = randomUUID();
      await client.query(
        "INSERT INTO alert_rules (id, tenant_id, metric, comparator, threshold) VALUES ($1, $2, $3, $4, $5)",
        [id, body.tenantId, body.metric, body.comparator, body.threshold],
      );
      const response = { id, ...body, enabled: true };
      await completeIdempotent(client, key!, response);
      await client.query("COMMIT");
      return response;
    } catch (error) {
      await client.query("ROLLBACK"); throw error;
    } finally { client.release(); }
  }

  @Patch(":id")
  @UseGuards(JwtRolesGuard)
  async update(@Param("id") id: string, @Body() body: UpdateAlertRuleDto, @Req() req: AuthenticatedRequest) {
    const existing = await database().query<{ tenant_id: string }>("SELECT tenant_id FROM alert_rules WHERE id = $1", [id]);
    const rule = existing.rows[0];
    if (!rule) throw new NotFoundException("Alert rule not found.");
    requireTenantScope(req, rule.tenant_id);

    await queryAsTenant(
      rule.tenant_id,
      `UPDATE alert_rules SET
         enabled = COALESCE($2, enabled), threshold = COALESCE($3, threshold), updated_at = NOW()
       WHERE id = $1`,
      [id, body.enabled ?? null, body.threshold ?? null],
    );
    return { id, accepted: true };
  }

  @Get("patient")
  @UseGuards(JwtRolesGuard)
  async patientRule(
    @Query("userId") userId: string | undefined,
    @Query("tenantId") tenantId: string | undefined,
    @Query("metric") metric: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    if (!userId || !tenantId || !metric) {
      throw new BadRequestException("userId, tenantId and metric query parameters are required.");
    }
    requireTenantScope(req, tenantId);
    if (!(await isLinked(userId, tenantId))) throw new ForbiddenException("Patient is not linked to this tenant.");
    return await withTenantTransaction(tenantId, (client) => resolveEffectiveRule(client, userId, tenantId, metric));
  }

  @Put("patient")
  @UseGuards(JwtRolesGuard)
  async upsertPatientOverride(@Body() body: UpsertPatientAlertOverrideDto, @Req() req: AuthenticatedRequest) {
    requireTenantScope(req, body.tenantId);
    if (!(await isLinked(body.userId, body.tenantId))) throw new ForbiddenException("Patient is not linked to this tenant.");

    await queryAsTenant(
      body.tenantId,
      `INSERT INTO patient_alert_overrides (user_id, tenant_id, metric, comparator, threshold, enabled, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (user_id, tenant_id, metric) DO UPDATE SET
         comparator = EXCLUDED.comparator, threshold = EXCLUDED.threshold, enabled = EXCLUDED.enabled, updated_at = NOW()`,
      [body.userId, body.tenantId, body.metric, body.comparator, body.threshold, body.enabled],
    );
    return { accepted: true };
  }
}
