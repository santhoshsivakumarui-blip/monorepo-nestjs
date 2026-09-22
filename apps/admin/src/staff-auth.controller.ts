import {
  Body, Controller, ForbiddenException, Headers, Post, Req, UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { IsEmail, IsNotEmpty, IsOptional, IsString } from "class-validator";
import { randomUUID } from "crypto";
import {
  DomainEvent, EmailRequestedPayload, Topics,
} from "../../../libs/contracts/src/events";
import { database, setTenantContext } from "../../../libs/common/src/database";
import { enqueueOutbox } from "../../../libs/common/src/outbox";
import {
  beginIdempotent, completeIdempotent, requestFingerprint,
} from "../../../libs/common/src/idempotency";
import { DUMMY_PASSWORD_HASH, verifyPassword } from "../../../libs/common/src/password";
import { generateCode, hashCode, verifyCode } from "../../../libs/common/src/otp";
import { buildJwtConfig } from "../../../libs/common/src/oidc";
import { recordHospitalAuditEvent } from "./hospital-audit";

const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 5;

export class StaffLoginDto {
  @IsEmail() email!: string;
  @IsString() @IsNotEmpty() password!: string;
}

export class StaffLoginVerifyDto {
  @IsString() @IsNotEmpty() challengeId!: string;
  @IsString() @IsNotEmpty() code!: string;
  @IsOptional() @IsString() deviceLabel?: string;
}

interface RequestWithIp { ip: string; }

@Controller("auth/staff")
export class StaffAuthController {
  constructor(private readonly jwt: JwtService) {}

  @Post("login")
  async login(
    @Body() body: StaffLoginDto,
    @Headers("idempotency-key") key: string | undefined,
  ) {
    const { rows } = await database().query<{ id: string; password_hash: string; status: string }>(
      "SELECT id, password_hash, status FROM tenant_staff WHERE email = $1",
      [body.email],
    );
    const staff = rows[0];
    // Always run verifyPassword, even with no matching row, so response timing/shape
    // never reveals whether the email is registered.
    const passwordOk = verifyPassword(body.password, staff?.password_hash ?? DUMMY_PASSWORD_HASH);

    const client = await database().connect();
    try {
      await client.query("BEGIN");
      const replay = await beginIdempotent<{ challengeId: string }>(
        client, key, requestFingerprint("POST", "/auth/staff/login", body),
      );
      if (replay) { await client.query("COMMIT"); return replay; }

      if (!staff || staff.status !== "active" || !passwordOk) {
        throw new UnauthorizedException("Invalid credentials.");
      }

      // A failed-password-attempts lockout on this endpoint (distinct from the 2FA
      // code attempts cap below) is a known gap — not built in this pass.
      const challengeId = randomUUID();
      const code = generateCode();
      await client.query(
        "INSERT INTO login_challenges (id, staff_id, code_hash, expires_at) VALUES ($1, $2, $3, $4)",
        [challengeId, staff.id, hashCode(code), new Date(Date.now() + CHALLENGE_TTL_MS)],
      );

      const emailPayload: EmailRequestedPayload = {
        to: body.email, subject: "Your sign-in code",
        message: `Your Zentinel sign-in code is ${code}. It expires in 5 minutes.`,
      };
      const event: DomainEvent<EmailRequestedPayload> = {
        id: randomUUID(), type: Topics.emailRequested, occurredAt: new Date().toISOString(),
        correlationId: randomUUID(), payload: emailPayload,
      };
      await enqueueOutbox(client, event);

      const response = { challengeId };
      await completeIdempotent(client, key!, response);
      await client.query("COMMIT");
      return response;
    } catch (error) {
      await client.query("ROLLBACK"); throw error;
    } finally { client.release(); }
  }

  @Post("login/verify")
  async verify(@Body() body: StaffLoginVerifyDto, @Req() req: RequestWithIp) {
    // Committed immediately (no surrounding transaction) so a thrown rejection
    // below never rolls back the attempts increment — otherwise brute force
    // would be unlimited.
    const attempted = await database().query<{
      attempts: number; code_hash: string; expires_at: Date; staff_id: string;
    }>(
      `UPDATE login_challenges SET attempts = attempts + 1
       WHERE id = $1 AND consumed_at IS NULL
       RETURNING attempts, code_hash, expires_at, staff_id`,
      [body.challengeId],
    );
    const challenge = attempted.rows[0];
    if (!challenge) throw new UnauthorizedException("Invalid or already-used challenge.");
    if (challenge.attempts > MAX_ATTEMPTS) throw new ForbiddenException("Too many attempts.");
    if (new Date(challenge.expires_at).getTime() < Date.now()) throw new UnauthorizedException("Code expired.");
    if (!verifyCode(challenge.code_hash, body.code)) throw new UnauthorizedException("Incorrect code.");

    const staffResult = await database().query<{ tenant_id: string; role: string; email: string }>(
      "SELECT tenant_id, role, email FROM tenant_staff WHERE id = $1", [challenge.staff_id],
    );
    const staff = staffResult.rows[0];
    if (!staff) throw new UnauthorizedException("Account no longer exists.");

    const sessionClient = await database().connect();
    try {
      await sessionClient.query("BEGIN");
      await setTenantContext(sessionClient, staff.tenant_id);
      await sessionClient.query("UPDATE login_challenges SET consumed_at = NOW() WHERE id = $1", [body.challengeId]);
      await sessionClient.query(
        "UPDATE tenant_staff SET last_active_at = NOW() WHERE id = $1", [challenge.staff_id],
      );
      await sessionClient.query(
        "INSERT INTO staff_sessions (id, staff_id, device_label, ip_address) VALUES ($1, $2, $3, $4)",
        [randomUUID(), challenge.staff_id, body.deviceLabel ?? null, req.ip],
      );
      await recordHospitalAuditEvent(sessionClient, {
        tenantId: staff.tenant_id, actorId: challenge.staff_id, actorLabel: staff.email,
        action: "STAFF_LOGGED_IN", category: "Auth",
      });
      await sessionClient.query("COMMIT");
    } catch (error) {
      await sessionClient.query("ROLLBACK"); throw error;
    } finally { sessionClient.release(); }

    const jwtConfig = buildJwtConfig();
    const accessToken = this.jwt.sign(
      { sub: challenge.staff_id, roles: [staff.role], tenantId: staff.tenant_id },
      { issuer: jwtConfig.issuer, audience: jwtConfig.audience },
    );
    return { accessToken };
  }
}
