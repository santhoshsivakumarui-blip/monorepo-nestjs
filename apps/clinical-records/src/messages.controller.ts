import {
  BadRequestException, Body, Controller, Get, Header, Headers, Param, Post, Query, Req, UseGuards,
} from "@nestjs/common";
import { IsNotEmpty, IsString } from "class-validator";
import { randomUUID } from "crypto";
import { database, queryAsTenant, setTenantContext } from "../../../libs/common/src/database";
import {
  beginIdempotent, completeIdempotent, requestFingerprint,
} from "../../../libs/common/src/idempotency";
import { JwtRolesGuard } from "../../../libs/common/src/oidc";
import { AuthenticatedRequest, requireStaffOrSelf } from "./access";

export class SendMessageDto {
  @IsString() @IsNotEmpty() tenantId!: string;
  @IsString() @IsNotEmpty() text!: string;
}

function csvEscape(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

@Controller("patients")
export class MessagesController {
  @Get(":id/messages")
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
      "SELECT id, from_role, author_id, text, created_at FROM messages WHERE user_id = $1 AND tenant_id = $2 ORDER BY created_at",
      [id, tenantId],
    );
    return rows;
  }

  @Post(":id/messages")
  @UseGuards(JwtRolesGuard)
  async send(
    @Param("id") id: string,
    @Body() body: SendMessageDto,
    @Headers("idempotency-key") key: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    requireStaffOrSelf(req, id, body.tenantId);
    // fromRole/authorId are derived from the caller's own token, never client-supplied.
    const fromRole = req.user!.tenantId ? "clinician" : "patient";
    const authorId = req.user!.sub;

    const client = await database().connect();
    try {
      await client.query("BEGIN");
      await setTenantContext(client, body.tenantId);
      const replay = await beginIdempotent(
        client, key, requestFingerprint("POST", `/patients/${id}/messages`, body),
      );
      if (replay) { await client.query("COMMIT"); return replay; }

      const messageId = randomUUID();
      await client.query(
        "INSERT INTO messages (id, user_id, tenant_id, from_role, author_id, text) VALUES ($1, $2, $3, $4, $5, $6)",
        [messageId, id, body.tenantId, fromRole, authorId, body.text],
      );

      const response = { id: messageId, userId: id, tenantId: body.tenantId, fromRole, authorId, text: body.text };
      await completeIdempotent(client, key!, response);
      await client.query("COMMIT");
      return response;
    } catch (error) {
      await client.query("ROLLBACK"); throw error;
    } finally { client.release(); }
  }

  @Get(":id/messages/export")
  @UseGuards(JwtRolesGuard)
  @Header("Content-Type", "text/csv")
  @Header("Content-Disposition", "attachment; filename=messages.csv")
  async exportMessages(
    @Param("id") id: string,
    @Query("tenantId") tenantId: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    if (!tenantId) throw new BadRequestException("tenantId query parameter is required.");
    requireStaffOrSelf(req, id, tenantId);
    const { rows } = await queryAsTenant<{ from_role: string; author_id: string; text: string; created_at: string }>(
      tenantId,
      "SELECT from_role, author_id, text, created_at FROM messages WHERE user_id = $1 AND tenant_id = $2 ORDER BY created_at",
      [id, tenantId],
    );

    const lines = ["fromRole,authorId,text,createdAt"];
    for (const row of rows) {
      lines.push([row.from_role, row.author_id, row.text, row.created_at].map(csvEscape).join(","));
    }
    return lines.join("\n");
  }
}
