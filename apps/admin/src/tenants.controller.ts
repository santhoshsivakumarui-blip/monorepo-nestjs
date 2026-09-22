import {
  Body, Controller, Get, Headers, Param, Post, Req, UseGuards,
} from "@nestjs/common";
import {
  IsIn, IsNotEmpty, IsOptional, IsString, Matches, ValidateIf,
} from "class-validator";
import { randomUUID } from "crypto";
import {
  DomainEvent, TenantProvisionedPayload, Topics,
} from "../../../libs/contracts/src/events";
import { database } from "../../../libs/common/src/database";
import { enqueueOutbox } from "../../../libs/common/src/outbox";
import {
  beginIdempotent, completeIdempotent, requestFingerprint,
} from "../../../libs/common/src/idempotency";
import { JwtRolesGuard, RequireRolesGuard } from "../../../libs/common/src/oidc";
import { resolvePlacement } from "../../../libs/tenancy/src/placement-resolver";
import { getOrCreatePool } from "../../../libs/tenancy/src/connection-manager";
import { TENANT_SCOPED_SERVICES } from "../../../libs/tenancy/src/types";
import { recordAuditEvent, resolveAdminId } from "./audit";
import { provisionTenant } from "./tenant-provisioning";
import { provisionDedicatedDatabase } from "./provision-dedicated-database";

const provisionerGuard = new RequireRolesGuard(["PLATFORM_ADMIN", "PROVISIONER"]);

type Plan = "starter" | "growth" | "enterprise";
type Mode = "pooled" | "dedicated";

/** Starter/Growth default to the shared pool; Enterprise defaults to a dedicated database. */
function defaultModeForPlan(plan: Plan): Mode {
  return plan === "enterprise" ? "dedicated" : "pooled";
}

export class CreateTenantDto {
  @IsString()
  @Matches(/^[a-z0-9-]+$/, { message: "tenantCode must be lowercase kebab-case, e.g. mount-sinai-nyc" })
  tenantCode!: string;
  @IsString() @IsNotEmpty() legalName!: string;
  @IsString() @IsNotEmpty() complianceFramework!: string;
  @IsIn(["starter", "growth", "enterprise"]) plan!: Plan;
  @IsOptional() @IsIn(["pooled", "dedicated"]) mode?: Mode;
  @IsString() @IsNotEmpty() regionAffinity!: string;

  // Only required when the resolved mode is dedicated — pooled tenants share
  // the platform-managed vault/KMS setup and never populate these.
  @ValidateIf((dto: CreateTenantDto) => (dto.mode ?? defaultModeForPlan(dto.plan)) === "dedicated")
  @IsString() @IsNotEmpty()
  vaultSecretPath?: string;

  @ValidateIf((dto: CreateTenantDto) => (dto.mode ?? defaultModeForPlan(dto.plan)) === "dedicated")
  @IsString() @IsNotEmpty()
  kmsKeyArn?: string;
}

interface AuthenticatedRequest { user?: { sub: string }; ip: string; }

@Controller("tenants")
export class TenantsController {
  @Get("health") health() { return { status: "ok", service: "admin" }; }

  @Post()
  @UseGuards(JwtRolesGuard, provisionerGuard)
  async create(
    @Body() body: CreateTenantDto,
    @Headers("idempotency-key") key: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    const tenantId = randomUUID();
    const mode = body.mode ?? defaultModeForPlan(body.plan);

    const client = await database().connect();
    let provisionResult: Awaited<ReturnType<typeof provisionTenant>>;
    let payload: TenantProvisionedPayload;
    try {
      await client.query("BEGIN");
      const replay = await beginIdempotent<TenantProvisionedPayload>(client, key, requestFingerprint("POST", "/tenants", body));
      if (replay) { await client.query("COMMIT"); return replay; }
      const adminId = await resolveAdminId(client, req.user!.sub);
      provisionResult = await provisionTenant(client, {
        tenantId, slug: body.tenantCode, legalName: body.legalName,
        complianceFramework: body.complianceFramework, plan: body.plan, mode,
        regionAffinity: body.regionAffinity,
        vaultSecretPath: body.vaultSecretPath ?? null, kmsKeyArn: body.kmsKeyArn ?? null,
      });
      payload = {
        tenantId, tenantCode: body.tenantCode, legalName: body.legalName,
        complianceFramework: body.complianceFramework, plan: body.plan, mode,
        databaseKeys: provisionResult.placements.map((p) => p.databaseKey),
        regionAffinity: body.regionAffinity, status: mode === "pooled" ? "active" : "provisioning",
      };
      const event: DomainEvent<TenantProvisionedPayload> = {
        id: randomUUID(), type: Topics.tenantProvisioned, occurredAt: new Date().toISOString(),
        correlationId: randomUUID(), payload,
      };
      await recordAuditEvent(client, { adminId, action: "TENANT_PROVISIONED", targetTenantId: tenantId, ipAddress: req.ip, payload });
      await enqueueOutbox(client, event);
      await completeIdempotent(client, key!, payload);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK"); throw error;
    } finally { client.release(); }

    if (mode === "pooled") return payload;

    // Dedicated: the metadata (tenants + tenant_database_assignments rows,
    // each starting 'provisioning') is already committed above. What's left
    // is the actual infrastructure work — CREATE DATABASE + run that
    // service's migrations — which can't happen inside the same
    // transaction (it targets a different database entirely) and is
    // deliberately synchronous here rather than a queued job, matching
    // this phase's scope (see the conversation this came out of: prove the
    // mechanism end-to-end for real before adding async/retry machinery).
    const provisioned = [];
    for (const service of TENANT_SCOPED_SERVICES) {
      provisioned.push(await provisionDedicatedDatabase(tenantId, body.tenantCode, service));
    }

    return {
      ...payload,
      status: "active",
      // Connection strings never reach this response — provisionDedicatedDatabase
      // already stored each one encrypted (see libs/tenancy/src/secret-store.ts).
      // getOrCreatePool fetches them back by databaseKey when a request needs them.
      dedicatedDatabases: provisioned.map((p) => ({
        service: p.service, databaseKey: p.databaseKey, appliedMigrations: p.appliedMigrations.length,
      })),
    };
  }

  @Get()
  @UseGuards(JwtRolesGuard)
  async list() {
    // A dedicated tenant now has one tenant_database_assignments row PER
    // service (see 0005_per_service_tenant_placement.sql), so the join is
    // aggregated into a `placements` array instead of one flat row per
    // tenant — a plain LEFT JOIN would otherwise return an Enterprise
    // tenant once per service.
    const { rows } = await database().query(
      `SELECT t.id, t.slug AS tenant_code, t.legal_name, t.compliance_framework, t.plan,
              t.region_affinity, t.status, t.created_at,
              json_agg(
                json_build_object(
                  'service', a.service, 'mode', a.mode,
                  'databaseKey', a.database_key, 'status', a.status
                ) ORDER BY a.service
              ) FILTER (WHERE a.tenant_id IS NOT NULL) AS placements
       FROM tenants t
       LEFT JOIN tenant_database_assignments a ON a.tenant_id = t.id
       GROUP BY t.id
       ORDER BY t.created_at DESC`,
    );
    return rows;
  }

  /**
   * A pooled tenant has one placement (service = '*', see resolvePlacement);
   * a dedicated tenant has one per TENANT_SCOPED_SERVICES entry, so this
   * checks all of them and reports per service. A dedicated service whose
   * secret was never stored (see provision-dedicated-database.ts /
   * secret-store.ts) reports reachable: false with that reason, rather
   * than 500ing the whole request.
   */
  @Get(":id/placement/health")
  @UseGuards(JwtRolesGuard)
  async placementHealth(@Param("id") id: string) {
    const results = [];
    for (const service of TENANT_SCOPED_SERVICES) {
      try {
        const placement = await resolvePlacement(id, service);
        const pool = await getOrCreatePool(placement.databaseKey);
        await pool.query("SELECT 1");
        results.push({ service, databaseKey: placement.databaseKey, mode: placement.mode, reachable: true });
      } catch (error) {
        results.push({
          service, reachable: false,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }
    return { tenantId: id, placements: results };
  }
}
