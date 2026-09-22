import { BadRequestException, Body, Controller, Headers, Post } from "@nestjs/common";
import { IsNotEmpty, IsString, MinLength } from "class-validator";
import { createHash, randomBytes, randomUUID } from "crypto";
import {
  DomainEvent, EmailRequestedPayload, Topics,
} from "../../../libs/contracts/src/events";
import { database, setTenantContext } from "../../../libs/common/src/database";
import { enqueueOutbox } from "../../../libs/common/src/outbox";
import {
  beginIdempotent, completeIdempotent, requestFingerprint,
} from "../../../libs/common/src/idempotency";
import { hashPassword } from "../../../libs/common/src/password";

const RESET_TTL_MS = 60 * 60 * 1000;

export class RequestPasswordResetDto {
  @IsString() @IsNotEmpty() email!: string;
}

export class ConfirmPasswordResetDto {
  @IsString() @IsNotEmpty() token!: string;
  @IsString() @MinLength(8) newPassword!: string;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

@Controller("auth/staff/password-reset")
export class PasswordResetController {
  @Post("request")
  async request(
    @Body() body: RequestPasswordResetDto,
    @Headers("idempotency-key") key: string | undefined,
  ) {
    // Same response regardless of whether the email is registered — enumeration-resistant.
    const { rows } = await database().query<{ id: string }>(
      "SELECT id FROM tenant_staff WHERE email = $1 AND status = 'active'", [body.email],
    );
    const staffId = rows[0]?.id;

    const client = await database().connect();
    try {
      await client.query("BEGIN");
      const replay = await beginIdempotent<{ requested: boolean }>(
        client, key, requestFingerprint("POST", "/auth/staff/password-reset/request", body),
      );
      if (replay) { await client.query("COMMIT"); return replay; }

      if (staffId) {
        const token = randomBytes(24).toString("hex");
        await client.query(
          "INSERT INTO password_reset_tokens (token_hash, staff_id, expires_at) VALUES ($1, $2, $3)",
          [hashToken(token), staffId, new Date(Date.now() + RESET_TTL_MS)],
        );
        const emailPayload: EmailRequestedPayload = {
          to: body.email, subject: "Reset your Zentinel password",
          message: `Reset your password with this token: ${token} (expires in 1 hour).`,
        };
        const event: DomainEvent<EmailRequestedPayload> = {
          id: randomUUID(), type: Topics.emailRequested, occurredAt: new Date().toISOString(),
          correlationId: randomUUID(), payload: emailPayload,
        };
        await enqueueOutbox(client, event);
      }

      const response = { requested: true };
      await completeIdempotent(client, key!, response);
      await client.query("COMMIT");
      return response;
    } catch (error) {
      await client.query("ROLLBACK"); throw error;
    } finally { client.release(); }
  }

  @Post("confirm")
  async confirm(@Body() body: ConfirmPasswordResetDto) {
    const client = await database().connect();
    try {
      await client.query("BEGIN");
      const existing = await client.query<{ staff_id: string; expires_at: Date; consumed_at: Date | null }>(
        "SELECT staff_id, expires_at, consumed_at FROM password_reset_tokens WHERE token_hash = $1 FOR UPDATE",
        [hashToken(body.token)],
      );
      const reset = existing.rows[0];
      if (!reset || reset.consumed_at) throw new BadRequestException("Reset token not found or already used.");
      if (new Date(reset.expires_at).getTime() < Date.now()) throw new BadRequestException("Reset token has expired.");

      const staff = await client.query<{ tenant_id: string }>("SELECT tenant_id FROM tenant_staff WHERE id = $1", [reset.staff_id]);
      if (staff.rows[0]) await setTenantContext(client, staff.rows[0].tenant_id);
      await client.query("UPDATE tenant_staff SET password_hash = $2 WHERE id = $1", [reset.staff_id, hashPassword(body.newPassword)]);
      await client.query("UPDATE password_reset_tokens SET consumed_at = NOW() WHERE token_hash = $1", [hashToken(body.token)]);
      await client.query("COMMIT");
      return { accepted: true };
    } catch (error) {
      await client.query("ROLLBACK"); throw error;
    } finally { client.release(); }
  }
}
