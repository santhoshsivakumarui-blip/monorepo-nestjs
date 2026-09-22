import {
  BadRequestException, Body, Controller, ForbiddenException, Get, Headers, Post, Put, Query, Req, Res, UseGuards,
} from "@nestjs/common";
import type { Response } from "express";
import { Type } from "class-transformer";
import {
  ArrayMinSize, IsArray, IsBoolean, IsIn, IsISO8601, IsNotEmpty, IsNumber, IsString, ValidateNested,
} from "class-validator";
import { randomUUID } from "crypto";
import { database, queryAsTenant, setTenantContext } from "../../../libs/common/src/database";
import {
  beginIdempotent, completeIdempotent, requestFingerprint,
} from "../../../libs/common/src/idempotency";
import { JwtRolesGuard } from "../../../libs/common/src/oidc";
import { AuthenticatedRequest, isLinked, requireTenantScope } from "./tenant-scope";
import { insertReading, resolveLinkedTenant, validateVitalReading } from "./readings";
import { VitalEventsService } from "./vital-events.service";

/** Free-text metric names so a future device can add new ones without a migration; consent is scoped to a fixed category set. */
const METRIC_CATEGORY: Record<string, string> = {
  heart_rate: "heart_rate",
  spo2: "spo2",
  blood_pressure_systolic: "blood_pressure",
  blood_pressure_diastolic: "blood_pressure",
  temperature: "temperature",
  hrv: "hrv",
  steps: "activity",
  sleep_minutes: "activity",
};
const CONSENT_CATEGORIES = ["heart_rate", "spo2", "blood_pressure", "temperature", "hrv", "activity"];

class VitalsReadingDto {
  @IsString() @IsNotEmpty() metric!: string;
  @IsNumber() value!: number;
  @IsString() @IsNotEmpty() unit!: string;
  @IsISO8601() recordedAt!: string;
  @IsString() @IsNotEmpty() source!: string;
}

export class IngestVitalsDto {
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => VitalsReadingDto)
  readings!: VitalsReadingDto[];
}

export class UpdateConsentDto {
  @IsString() @IsNotEmpty() tenantId!: string;
  @IsIn(CONSENT_CATEGORIES) category!: string;
  @IsBoolean() enabled!: boolean;
}

@Controller("vitals")
export class VitalsController {
  // The default keeps direct controller unit tests simple; Nest injects the
  // singleton in production so all requests on a replica share one stream.
  constructor(private readonly vitalEvents: VitalEventsService = new VitalEventsService()) {}
  @Get("health") health() { return { status: "ok", service: "vitals" }; }

  @Post("ingest")
  @UseGuards(JwtRolesGuard)
  async ingest(
    @Body() body: IngestVitalsDto,
    @Headers("idempotency-key") key: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    const userId = req.user!.sub;
    const client = await database().connect();
    try {
      await client.query("BEGIN");
      const replay = await beginIdempotent<{ accepted: number }>(
        client, key, requestFingerprint("POST", "/vitals/ingest", body),
      );
      if (replay) { await client.query("COMMIT"); return replay; }

      const linkedTenantId = await resolveLinkedTenant(client, userId);
      if (linkedTenantId) await setTenantContext(client, linkedTenantId);
      let accepted = 0;
      for (const reading of body.readings) {
        try { validateVitalReading(reading); } catch (error) {
          throw new BadRequestException(error instanceof Error ? error.message : "Invalid vital reading.");
        }
        if (await insertReading(client, userId, linkedTenantId, reading)) {
          accepted += 1;
          if (linkedTenantId) this.vitalEvents.publish({ tenantId: linkedTenantId, userId, metric: reading.metric, recordedAt: reading.recordedAt });
        }
      }

      const response = { accepted };
      await completeIdempotent(client, key!, response);
      await client.query("COMMIT");
      return response;
    } catch (error) {
      await client.query("ROLLBACK"); throw error;
    } finally { client.release(); }
  }

  /** Authenticated SSE feed used by clinic dashboards to invalidate live data.
   * Heartbeats keep proxies from timing out idle clinical sessions. */
  @Get("events")
  @UseGuards(JwtRolesGuard)
  events(@Query("tenantId") tenantId: string | undefined, @Req() req: AuthenticatedRequest & { on: Function }, @Res() res: Response) {
    if (!tenantId) throw new BadRequestException("tenantId query parameter is required.");
    requireTenantScope(req, tenantId);
    res.status(200).set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" });
    res.flushHeaders();
    const unsubscribe = this.vitalEvents.subscribe(tenantId, (event) => res.write(`event: vital.ingested\ndata: ${JSON.stringify(event)}\n\n`));
    const heartbeat = setInterval(() => res.write(": keepalive\n\n"), 25_000);
    req.on("close", () => { clearInterval(heartbeat); unsubscribe(); res.end(); });
  }

  @Get("mine/latest")
  @UseGuards(JwtRolesGuard)
  async mineLatest(@Req() req: AuthenticatedRequest) {
    const { rows } = await database().query(
      `SELECT DISTINCT ON (metric) metric, value, unit, recorded_at, source
       FROM vitals_readings WHERE user_id = $1
       ORDER BY metric, recorded_at DESC`,
      [req.user!.sub],
    );
    return rows;
  }

  @Get("mine")
  @UseGuards(JwtRolesGuard)
  async mine(
    @Query("metric") metric: string | undefined,
    @Query("from") from: string | undefined,
    @Query("to") to: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    return queryReadings(req.user!.sub, { metric, from, to });
  }

  @Get("consent/mine")
  @UseGuards(JwtRolesGuard)
  async consentMine(@Query("tenantId") tenantId: string | undefined, @Req() req: AuthenticatedRequest) {
    if (!tenantId) throw new BadRequestException("tenantId query parameter is required.");
    const { rows } = await queryAsTenant(
      tenantId,
      "SELECT category, enabled FROM vitals_consent WHERE user_id = $1 AND tenant_id = $2",
      [req.user!.sub, tenantId],
    );
    return rows;
  }

  @Put("consent/mine")
  @UseGuards(JwtRolesGuard)
  async updateConsentMine(@Body() body: UpdateConsentDto, @Req() req: AuthenticatedRequest) {
    await queryAsTenant(
      body.tenantId,
      `INSERT INTO vitals_consent (user_id, tenant_id, category, enabled, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (user_id, tenant_id, category) DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = NOW()`,
      [req.user!.sub, body.tenantId, body.category, body.enabled],
    );
    return { tenantId: body.tenantId, category: body.category, enabled: body.enabled };
  }

  /** Hospital's read-only view of a linked patient's consent — powers the clinic app's consent tab. */
  @Get("consent")
  @UseGuards(JwtRolesGuard)
  async consentForTenant(
    @Query("userId") userId: string | undefined,
    @Query("tenantId") tenantId: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    if (!userId || !tenantId) throw new BadRequestException("userId and tenantId query parameters are required.");
    requireTenantScope(req, tenantId);
    if (!(await isLinked(userId, tenantId))) {
      throw new ForbiddenException("Patient is not linked to this tenant.");
    }
    const { rows } = await queryAsTenant(
      tenantId,
      "SELECT category, enabled FROM vitals_consent WHERE user_id = $1 AND tenant_id = $2",
      [userId, tenantId],
    );
    return rows;
  }

  /** Consent-gated hospital-visibility read: only linked AND consented categories, never all-or-nothing. */
  @Get("shared")
  @UseGuards(JwtRolesGuard)
  async shared(
    @Query("userId") userId: string | undefined,
    @Query("tenantId") tenantId: string | undefined,
    @Query("metric") metric: string | undefined,
    @Query("from") from: string | undefined,
    @Query("to") to: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    if (!userId || !tenantId) throw new BadRequestException("userId and tenantId query parameters are required.");
    requireTenantScope(req, tenantId);
    if (!(await isLinked(userId, tenantId))) {
      throw new ForbiddenException("Patient is not linked to this tenant.");
    }

    const consentRows = await queryAsTenant<{ category: string }>(
      tenantId,
      "SELECT category FROM vitals_consent WHERE user_id = $1 AND tenant_id = $2 AND enabled = true",
      [userId, tenantId],
    );
    const allowedCategories = new Set(consentRows.rows.map((row) => row.category));
    const allowedMetrics = Object.entries(METRIC_CATEGORY)
      .filter(([, category]) => allowedCategories.has(category))
      .map(([metricName]) => metricName);

    if (metric && !allowedMetrics.includes(metric)) return [];
    if (allowedMetrics.length === 0) return [];

    const readings = await queryReadings(userId, { metric, from, to, restrictToMetrics: metric ? undefined : allowedMetrics });
    // Logged only here, not on /vitals/shared/roster — see the plan's named scope note.
    await queryAsTenant(
      tenantId,
      "INSERT INTO vitals_access_log (id, user_id, tenant_id, accessed_by) VALUES ($1, $2, $3, $4)",
      [randomUUID(), userId, tenantId, req.user!.sub],
    );
    return readings;
  }

  /** Powers the patient app's Data-shared "who viewed my chart" list. */
  @Get("access-log/mine")
  @UseGuards(JwtRolesGuard)
  async accessLogMine(@Query("days") daysRaw: string | undefined, @Req() req: AuthenticatedRequest) {
    const days = daysRaw ? Number(daysRaw) : 30;
    // Deliberately not tenant-scoped: this is the patient's own audit trail across
    // every hospital they've ever been linked to, not one tenant's view. Once RLS is
    // actually enforced (FORCE + restricted role), this endpoint will need its own
    // policy path (e.g. an app.user_id-based OR clause) rather than app.tenant_id.
    const { rows } = await database().query(
      `SELECT id, tenant_id, accessed_by, created_at FROM vitals_access_log
       WHERE user_id = $1 AND created_at >= (now() - ($2::int || ' days')::interval)
       ORDER BY created_at DESC`,
      [req.user!.sub, days],
    );
    return rows;
  }

  /** Same consent-gating as /vitals/shared, batched for every patient linked to the tenant — powers the clinic roster's inline vitals column. */
  @Get("shared/roster")
  @UseGuards(JwtRolesGuard)
  async sharedRoster(@Query("tenantId") tenantId: string | undefined, @Req() req: AuthenticatedRequest) {
    if (!tenantId) throw new BadRequestException("tenantId query parameter is required.");
    requireTenantScope(req, tenantId);

    const consentRows = await queryAsTenant<{ user_id: string; category: string }>(
      tenantId,
      `SELECT c.user_id, vc.category
       FROM patient_hospital_link_cache c
       JOIN vitals_consent vc ON vc.user_id = c.user_id AND vc.tenant_id = c.tenant_id AND vc.enabled = true
       WHERE c.tenant_id = $1`,
      [tenantId],
    );
    const allowedByUser = new Map<string, Set<string>>();
    for (const row of consentRows.rows) {
      if (!allowedByUser.has(row.user_id)) allowedByUser.set(row.user_id, new Set());
      allowedByUser.get(row.user_id)!.add(row.category);
    }
    const userIds = [...allowedByUser.keys()];
    if (userIds.length === 0) return [];

    const readingRows = await database().query<{
      user_id: string; metric: string; value: string; unit: string; recorded_at: string;
    }>(
      `SELECT DISTINCT ON (user_id, metric) user_id, metric, value, unit, recorded_at
       FROM vitals_readings WHERE user_id = ANY($1)
       ORDER BY user_id, metric, recorded_at DESC`,
      [userIds],
    );

    const readingsByUser = new Map<string, Array<{ metric: string; value: string; unit: string; recordedAt: string }>>();
    for (const row of readingRows.rows) {
      const category = METRIC_CATEGORY[row.metric];
      if (!category || !allowedByUser.get(row.user_id)?.has(category)) continue;
      if (!readingsByUser.has(row.user_id)) readingsByUser.set(row.user_id, []);
      readingsByUser.get(row.user_id)!.push({
        metric: row.metric, value: row.value, unit: row.unit, recordedAt: row.recorded_at,
      });
    }

    return userIds.map((userId) => ({ userId, readings: readingsByUser.get(userId) ?? [] }));
  }
}

async function queryReadings(
  userId: string,
  opts: { metric?: string; from?: string; to?: string; restrictToMetrics?: string[] },
) {
  const conditions = ["user_id = $1"];
  const params: unknown[] = [userId];

  if (opts.metric) {
    params.push(opts.metric);
    conditions.push(`metric = $${params.length}`);
  } else if (opts.restrictToMetrics) {
    if (opts.restrictToMetrics.length === 0) return [];
    params.push(opts.restrictToMetrics);
    conditions.push(`metric = ANY($${params.length})`);
  }
  if (opts.from) {
    params.push(opts.from);
    conditions.push(`recorded_at >= $${params.length}`);
  }
  if (opts.to) {
    params.push(opts.to);
    conditions.push(`recorded_at <= $${params.length}`);
  }

  const { rows } = await database().query(
    `SELECT metric, value, unit, recorded_at, source FROM vitals_readings
     WHERE ${conditions.join(" AND ")} ORDER BY recorded_at DESC`,
    params,
  );
  return rows;
}
