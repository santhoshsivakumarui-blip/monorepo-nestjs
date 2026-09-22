import {
  BadRequestException, Body, Controller, Get, Headers, NotFoundException, Param, Post, Query, Req, UseGuards,
} from "@nestjs/common";
import { IsIn, IsNotEmpty, IsNumber, IsOptional, IsString } from "class-validator";
import { randomUUID } from "crypto";
import { database, queryAsTenant, setTenantContext } from "../../../libs/common/src/database";
import {
  beginIdempotent, completeIdempotent, requestFingerprint,
} from "../../../libs/common/src/idempotency";
import { JwtRolesGuard } from "../../../libs/common/src/oidc";
import { AuthenticatedRequest, requireStaffForTenant, requireStaffOrSelf } from "./access";

export class RegisterFileDto {
  @IsString() @IsNotEmpty() tenantId!: string;
  @IsString() @IsNotEmpty() name!: string;
  @IsIn(["pdf", "image", "dicom"]) kind!: "pdf" | "image" | "dicom";
  @IsOptional() @IsNumber() sizeBytes?: number;
}

@Controller("patients")
export class FilesController {
  @Get(":id/files")
  @UseGuards(JwtRolesGuard)
  async list(
    @Param("id") id: string,
    @Query("tenantId") tenantId: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    if (!tenantId) throw new BadRequestException("tenantId query parameter is required.");
    requireStaffOrSelf(req, id, tenantId);
    const { rows } = await queryAsTenant(
      tenantId,
      "SELECT id, name, kind, size_bytes, uploaded_by, url, created_at FROM patient_files WHERE user_id = $1 AND tenant_id = $2 ORDER BY created_at DESC",
      [id, tenantId],
    );
    return rows;
  }

  @Post(":id/files")
  @UseGuards(JwtRolesGuard)
  async register(
    @Param("id") id: string,
    @Body() body: RegisterFileDto,
    @Headers("idempotency-key") key: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    requireStaffForTenant(req, body.tenantId);

    const client = await database().connect();
    try {
      await client.query("BEGIN");
      await setTenantContext(client, body.tenantId);
      const replay = await beginIdempotent(
        client, key, requestFingerprint("POST", `/patients/${id}/files`, body),
      );
      if (replay) { await client.query("COMMIT"); return replay; }

      const fileId = randomUUID();
      await client.query(
        `INSERT INTO patient_files (id, user_id, tenant_id, name, kind, size_bytes, uploaded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [fileId, id, body.tenantId, body.name, body.kind, body.sizeBytes ?? null, req.user!.sub],
      );

      const response = {
        id: fileId, userId: id, tenantId: body.tenantId, name: body.name, kind: body.kind,
        sizeBytes: body.sizeBytes ?? null, uploadedBy: req.user!.sub, url: null,
      };
      await completeIdempotent(client, key!, response);
      await client.query("COMMIT");
      return response;
    } catch (error) {
      await client.query("ROLLBACK"); throw error;
    } finally { client.release(); }
  }

  @Get(":id/files/:fileId")
  @UseGuards(JwtRolesGuard)
  async get(
    @Param("id") id: string,
    @Param("fileId") fileId: string,
    @Query("tenantId") tenantId: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    if (!tenantId) throw new BadRequestException("tenantId query parameter is required.");
    requireStaffOrSelf(req, id, tenantId);
    const { rows } = await queryAsTenant(
      tenantId,
      "SELECT id, name, kind, size_bytes, uploaded_by, url, created_at FROM patient_files WHERE id = $1 AND user_id = $2 AND tenant_id = $3",
      [fileId, id, tenantId],
    );
    if (!rows[0]) throw new NotFoundException("File not found.");
    return rows[0];
  }
}
