import {
  ArrayMinSize, IsArray, IsBoolean, IsNotEmpty, IsOptional, IsString, ValidateNested,
} from "class-validator";
import {
  BadRequestException, Body, Controller, ForbiddenException, Get, NotFoundException, Param, Post, Query, Req, UseGuards,
} from "@nestjs/common";
import { Type } from "class-transformer";
import { randomUUID } from "crypto";
import { database, queryAsTenant, setTenantContext } from "../../../libs/common/src/database";
import { JwtRolesGuard } from "../../../libs/common/src/oidc";
import { AuthenticatedRequest, requireStaffForTenant, requireStaffOrSelf } from "./access";

class ScanItemDto {
  @IsString() @IsNotEmpty() name!: string;
  @IsOptional() @IsString() dose?: string;
  @IsOptional() @IsString() confidence?: string;
  @IsOptional() @IsBoolean() needsCheck?: boolean;
}

export class CreatePrescriptionScanDto {
  @IsOptional() @IsString() tenantId?: string;
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => ScanItemDto)
  items!: ScanItemDto[];
}

export class ApproveScriptDto {
  @IsString() @IsNotEmpty() tenantId!: string;
}

@Controller()
export class PrescriptionScansController {
  @Post("prescription-scans")
  @UseGuards(JwtRolesGuard)
  async create(@Body() body: CreatePrescriptionScanDto, @Req() req: AuthenticatedRequest) {
    const userId = req.user!.sub;
    const client = await database().connect();
    try {
      await client.query("BEGIN");
      if (body.tenantId) await setTenantContext(client, body.tenantId);
      const scanId = randomUUID();
      await client.query(
        "INSERT INTO prescription_scans (id, user_id, tenant_id) VALUES ($1, $2, $3)",
        [scanId, userId, body.tenantId ?? null],
      );
      for (const item of body.items) {
        await client.query(
          "INSERT INTO prescription_scan_items (id, scan_id, name, dose, confidence, needs_check) VALUES ($1, $2, $3, $4, $5, $6)",
          [randomUUID(), scanId, item.name, item.dose ?? null, item.confidence ?? null, item.needsCheck ?? false],
        );
      }
      await client.query("COMMIT");
      return { id: scanId, status: "pending" };
    } catch (error) {
      await client.query("ROLLBACK"); throw error;
    } finally { client.release(); }
  }

  @Get("prescription-scans/mine")
  @UseGuards(JwtRolesGuard)
  async mine(@Req() req: AuthenticatedRequest) {
    // Deliberately not tenant-scoped: a patient's own scans can span more than
    // one tenant_id (or none). See vitals.controller.ts's accessLogMine for
    // the same pattern and its RLS-enforcement caveat.
    const { rows } = await database().query(
      `SELECT s.id AS scan_id, s.status AS scan_status, i.id, i.name, i.dose, i.confidence, i.needs_check, i.confirmed
       FROM prescription_scans s JOIN prescription_scan_items i ON i.scan_id = s.id
       WHERE s.user_id = $1 ORDER BY s.created_at DESC`,
      [req.user!.sub],
    );
    return rows;
  }

  @Post("prescription-scans/:id/items/:itemId/confirm")
  @UseGuards(JwtRolesGuard)
  async confirmItem(@Param("id") id: string, @Param("itemId") itemId: string, @Req() req: AuthenticatedRequest) {
    const scan = await database().query<{ user_id: string }>("SELECT user_id FROM prescription_scans WHERE id = $1", [id]);
    if (!scan.rows[0]) throw new NotFoundException("Scan not found.");
    if (scan.rows[0].user_id !== req.user!.sub) throw new ForbiddenException("Cannot manage another patient's scan.");

    await database().query("UPDATE prescription_scan_items SET confirmed = true WHERE id = $1 AND scan_id = $2", [itemId, id]);
    return { id: itemId, confirmed: true };
  }

  @Post("prescription-scans/:id/save")
  @UseGuards(JwtRolesGuard)
  async save(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    const scan = await database().query<{ user_id: string; tenant_id: string | null }>(
      "SELECT user_id, tenant_id FROM prescription_scans WHERE id = $1", [id],
    );
    const record = scan.rows[0];
    if (!record) throw new NotFoundException("Scan not found.");
    if (record.user_id !== req.user!.sub) throw new ForbiddenException("Cannot manage another patient's scan.");

    const client = await database().connect();
    try {
      await client.query("BEGIN");
      if (record.tenant_id) await setTenantContext(client, record.tenant_id);
      const items = await client.query<{ id: string; name: string; dose: string | null }>(
        "SELECT id, name, dose FROM prescription_scan_items WHERE scan_id = $1 AND confirmed = true", [id],
      );
      for (const item of items.rows) {
        await client.query(
          "INSERT INTO active_medications (id, user_id, tenant_id, name, dose, source_scan_id) VALUES ($1, $2, $3, $4, $5, $6)",
          [randomUUID(), record.user_id, record.tenant_id, item.name, item.dose, id],
        );
      }
      await client.query("UPDATE prescription_scans SET status = 'confirmed' WHERE id = $1", [id]);
      await client.query("COMMIT");
      return { id, saved: items.rows.length };
    } catch (error) {
      await client.query("ROLLBACK"); throw error;
    } finally { client.release(); }
  }

  @Get("patients/:id/scripts/queue")
  @UseGuards(JwtRolesGuard)
  async queue(
    @Param("id") id: string,
    @Query("tenantId") tenantId: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    if (!tenantId) throw new BadRequestException("tenantId query parameter is required.");
    requireStaffOrSelf(req, id, tenantId);
    const { rows } = await queryAsTenant(
      tenantId,
      `SELECT i.id, i.name, i.dose, i.confidence, i.needs_check, s.id AS scan_id, s.created_at
       FROM prescription_scan_items i JOIN prescription_scans s ON s.id = i.scan_id
       WHERE s.user_id = $1 AND i.confirmed = false ORDER BY s.created_at DESC`,
      [id],
    );
    return rows;
  }

  @Post("patients/:id/scripts/:itemId/approve")
  @UseGuards(JwtRolesGuard)
  async approve(
    @Param("id") id: string,
    @Param("itemId") itemId: string,
    @Body() body: ApproveScriptDto,
    @Req() req: AuthenticatedRequest,
  ) {
    requireStaffForTenant(req, body.tenantId);
    const item = await database().query<{ name: string; dose: string | null; scan_id: string }>(
      "SELECT name, dose, scan_id FROM prescription_scan_items WHERE id = $1", [itemId],
    );
    if (!item.rows[0]) throw new NotFoundException("Script item not found.");

    const client = await database().connect();
    try {
      await client.query("BEGIN");
      await setTenantContext(client, body.tenantId);
      await client.query("UPDATE prescription_scan_items SET confirmed = true WHERE id = $1", [itemId]);
      await client.query(
        "INSERT INTO active_medications (id, user_id, tenant_id, name, dose, source_scan_id) VALUES ($1, $2, $3, $4, $5, $6)",
        [randomUUID(), id, body.tenantId, item.rows[0].name, item.rows[0].dose, item.rows[0].scan_id],
      );
      await client.query("COMMIT");
      return { id: itemId, approved: true };
    } catch (error) {
      await client.query("ROLLBACK"); throw error;
    } finally { client.release(); }
  }

  @Get("medications/active")
  @UseGuards(JwtRolesGuard)
  async active(
    @Query("userId") userId: string | undefined,
    @Query("tenantId") tenantId: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    if (!userId || !tenantId) throw new BadRequestException("userId and tenantId query parameters are required.");
    requireStaffOrSelf(req, userId, tenantId);
    const { rows } = await queryAsTenant(
      tenantId,
      "SELECT id, name, dose, created_at FROM active_medications WHERE user_id = $1 AND tenant_id = $2 ORDER BY created_at DESC",
      [userId, tenantId],
    );
    return rows;
  }
}
