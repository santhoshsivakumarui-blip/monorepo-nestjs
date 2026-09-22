import {
  BadRequestException, Body, Controller, Get, Headers, Param, Post, Query, Req, UseGuards,
} from "@nestjs/common";
import { IsIn, IsNotEmpty, IsString } from "class-validator";
import { randomUUID } from "crypto";
import { database, queryAsTenant, setTenantContext } from "../../../libs/common/src/database";
import {
  beginIdempotent, completeIdempotent, requestFingerprint,
} from "../../../libs/common/src/idempotency";
import { JwtRolesGuard } from "../../../libs/common/src/oidc";
import { AuthenticatedRequest, requireStaffForTenant, requireStaffOrSelf } from "./access";

export class AddNoteDto {
  @IsString() @IsNotEmpty() tenantId!: string;
  @IsString() @IsNotEmpty() text!: string;
  @IsIn(["clinical", "system"]) kind!: "clinical" | "system";
}

@Controller("patients")
export class NotesController {
  @Get(":id/notes")
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
      "SELECT id, kind, text, author_id, created_at FROM notes WHERE user_id = $1 AND tenant_id = $2 ORDER BY created_at DESC",
      [id, tenantId],
    );
    return rows;
  }

  @Post(":id/notes")
  @UseGuards(JwtRolesGuard)
  async add(
    @Param("id") id: string,
    @Body() body: AddNoteDto,
    @Headers("idempotency-key") key: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    requireStaffForTenant(req, body.tenantId);

    const client = await database().connect();
    try {
      await client.query("BEGIN");
      await setTenantContext(client, body.tenantId);
      const replay = await beginIdempotent(
        client, key, requestFingerprint("POST", `/patients/${id}/notes`, body),
      );
      if (replay) { await client.query("COMMIT"); return replay; }

      const noteId = randomUUID();
      await client.query(
        "INSERT INTO notes (id, user_id, tenant_id, kind, text, author_id) VALUES ($1, $2, $3, $4, $5, $6)",
        [noteId, id, body.tenantId, body.kind, body.text, req.user!.sub],
      );

      const response = { id: noteId, userId: id, tenantId: body.tenantId, kind: body.kind, text: body.text, authorId: req.user!.sub };
      await completeIdempotent(client, key!, response);
      await client.query("COMMIT");
      return response;
    } catch (error) {
      await client.query("ROLLBACK"); throw error;
    } finally { client.release(); }
  }
}
