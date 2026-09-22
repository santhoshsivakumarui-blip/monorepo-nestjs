import {
  ArrayMinSize, IsArray, IsISO8601, IsNotEmpty, IsOptional, IsString, ValidateNested,
} from "class-validator";
import {
  BadRequestException, Body, Controller, Get, Headers, Param, Post, Query, Req, UseGuards,
} from "@nestjs/common";
import { Type } from "class-transformer";
import { randomUUID } from "crypto";
import { database, queryAsTenant, setTenantContext } from "../../../libs/common/src/database";
import {
  beginIdempotent, completeIdempotent, requestFingerprint,
} from "../../../libs/common/src/idempotency";
import { JwtRolesGuard } from "../../../libs/common/src/oidc";
import { AuthenticatedRequest, requireStaffForTenant, requireStaffOrSelf } from "./access";

class VisitMedicationDto {
  @IsString() @IsNotEmpty() name!: string;
  @IsOptional() @IsString() dose?: string;
}

export class RecordVisitDto {
  @IsString() @IsNotEmpty() tenantId!: string;
  @IsOptional() @IsString() doctor?: string;
  @IsOptional() @IsString() reason?: string;
  @IsISO8601() occurredAt!: string;
  @IsArray() @ArrayMinSize(0) @ValidateNested({ each: true }) @Type(() => VisitMedicationDto)
  medications!: VisitMedicationDto[];
}

@Controller("patients")
export class VisitsController {
  @Get(":id/visits")
  @UseGuards(JwtRolesGuard)
  async list(
    @Param("id") id: string,
    @Query("tenantId") tenantId: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    if (!tenantId) throw new BadRequestException("tenantId query parameter is required.");
    requireStaffOrSelf(req, id, tenantId);

    const visits = await queryAsTenant(
      tenantId,
      `SELECT id, is_this_hospital, doctor, reason, occurred_at FROM visits
       WHERE user_id = $1 AND tenant_id = $2 ORDER BY occurred_at DESC`,
      [id, tenantId],
    );
    const visitIds = visits.rows.map((row) => row.id);
    const meds = visitIds.length
      ? await database().query<{ visit_id: string; name: string; dose: string | null }>(
          "SELECT visit_id, name, dose FROM visit_medications WHERE visit_id = ANY($1)",
          [visitIds],
        )
      : { rows: [] as Array<{ visit_id: string; name: string; dose: string | null }> };

    const medsByVisit = new Map<string, Array<{ name: string; dose: string | null }>>();
    for (const med of meds.rows) {
      if (!medsByVisit.has(med.visit_id)) medsByVisit.set(med.visit_id, []);
      medsByVisit.get(med.visit_id)!.push({ name: med.name, dose: med.dose });
    }

    return visits.rows.map((visit) => ({
      id: visit.id,
      isThisHospital: visit.is_this_hospital,
      doctor: visit.doctor,
      reason: visit.reason,
      occurredAt: visit.occurred_at,
      medications: medsByVisit.get(visit.id) ?? [],
    }));
  }

  @Post(":id/visits")
  @UseGuards(JwtRolesGuard)
  async record(
    @Param("id") id: string,
    @Body() body: RecordVisitDto,
    @Headers("idempotency-key") key: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    requireStaffForTenant(req, body.tenantId);

    const client = await database().connect();
    try {
      await client.query("BEGIN");
      await setTenantContext(client, body.tenantId);
      const replay = await beginIdempotent(
        client, key, requestFingerprint("POST", `/patients/${id}/visits`, body),
      );
      if (replay) { await client.query("COMMIT"); return replay; }

      const visitId = randomUUID();
      await client.query(
        `INSERT INTO visits (id, user_id, tenant_id, doctor, reason, occurred_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [visitId, id, body.tenantId, body.doctor ?? null, body.reason ?? null, body.occurredAt],
      );
      for (const med of body.medications) {
        await client.query(
          "INSERT INTO visit_medications (visit_id, name, dose) VALUES ($1, $2, $3)",
          [visitId, med.name, med.dose ?? null],
        );
      }

      const response = { id: visitId, userId: id, isThisHospital: true, ...body };
      await completeIdempotent(client, key!, response);
      await client.query("COMMIT");
      return response;
    } catch (error) {
      await client.query("ROLLBACK"); throw error;
    } finally { client.release(); }
  }
}
