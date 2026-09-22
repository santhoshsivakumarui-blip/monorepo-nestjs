import {
  Body, Controller, Get, Headers, Post, Query, Req, UseGuards,
} from "@nestjs/common";
import { IsInt, IsNotEmpty, IsNumber, IsOptional, IsString } from "class-validator";
import { randomUUID } from "crypto";
import { database } from "../../../libs/common/src/database";
import {
  beginIdempotent, completeIdempotent, requestFingerprint,
} from "../../../libs/common/src/idempotency";
import { JwtRolesGuard } from "../../../libs/common/src/oidc";
import { insertReading, resolveLinkedTenant } from "./readings";

/**
 * Client-captured/derived values only — there's no camera-based rPPG vitals
 * extraction anywhere in this codebase. This endpoint stores and evaluates
 * whatever the caller already computed, the same boundary SOS's client-supplied
 * vitals snapshot uses.
 */
export class SubmitFaceScanDto {
  @IsString() @IsNotEmpty() recordedAt!: string;
  @IsNumber() hr!: number;
  @IsNumber() bpSystolic!: number;
  @IsNumber() bpDiastolic!: number;
  @IsNumber() rr!: number;
  @IsNumber() spo2!: number;
  @IsNumber() temperature!: number;
  @IsNumber() hrv!: number;
  @IsOptional() @IsInt() overallScore?: number;
  @IsOptional() @IsInt() finalVitalsScore?: number;
  @IsOptional() @IsInt() activityScore?: number;
  @IsOptional() @IsInt() lifestyleScore?: number;
  @IsOptional() @IsInt() stressIndex?: number;
  @IsOptional() @IsInt() cardiacWorkload?: number;
  @IsOptional() @IsInt() parasympatheticActivity?: number;
}

interface AuthenticatedRequest { user?: { sub: string }; }

@Controller("face-scan")
export class FaceScanController {
  @Post("results")
  @UseGuards(JwtRolesGuard)
  async submit(
    @Body() body: SubmitFaceScanDto,
    @Headers("idempotency-key") key: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    const userId = req.user!.sub;
    const client = await database().connect();
    try {
      await client.query("BEGIN");
      const replay = await beginIdempotent<{ id: string }>(
        client, key, requestFingerprint("POST", "/face-scan/results", body),
      );
      if (replay) { await client.query("COMMIT"); return replay; }

      const linkedTenantId = await resolveLinkedTenant(client, userId);
      const readings: Array<{ metric: string; value: number; unit: string }> = [
        { metric: "heart_rate", value: body.hr, unit: "bpm" },
        { metric: "blood_pressure_systolic", value: body.bpSystolic, unit: "mmHg" },
        { metric: "blood_pressure_diastolic", value: body.bpDiastolic, unit: "mmHg" },
        { metric: "respiratory_rate", value: body.rr, unit: "breaths/min" },
        { metric: "spo2", value: body.spo2, unit: "%" },
        { metric: "temperature", value: body.temperature, unit: "C" },
        { metric: "hrv", value: body.hrv, unit: "ms" },
      ];
      for (const reading of readings) {
        await insertReading(client, userId, linkedTenantId, {
          ...reading, recordedAt: body.recordedAt, source: "face_scan",
        });
      }

      const resultId = randomUUID();
      await client.query(
        `INSERT INTO face_scan_results
           (id, user_id, overall_score, final_vitals_score, activity_score, lifestyle_score,
            stress_index, cardiac_workload, parasympathetic_activity)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          resultId, userId, body.overallScore ?? null, body.finalVitalsScore ?? null,
          body.activityScore ?? null, body.lifestyleScore ?? null, body.stressIndex ?? null,
          body.cardiacWorkload ?? null, body.parasympatheticActivity ?? null,
        ],
      );

      const response = { id: resultId };
      await completeIdempotent(client, key!, response);
      await client.query("COMMIT");
      return response;
    } catch (error) {
      await client.query("ROLLBACK"); throw error;
    } finally { client.release(); }
  }

  @Get("results/mine")
  @UseGuards(JwtRolesGuard)
  async mine(@Query("limit") limitRaw: string | undefined, @Req() req: AuthenticatedRequest) {
    const limit = limitRaw ? Number(limitRaw) : 10;
    const { rows } = await database().query(
      `SELECT id, overall_score, final_vitals_score, activity_score, lifestyle_score,
              stress_index, cardiac_workload, parasympathetic_activity, created_at
       FROM face_scan_results WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [req.user!.sub, limit],
    );
    return rows;
  }
}
