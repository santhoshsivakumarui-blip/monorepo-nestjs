import {
  Body, Controller, ForbiddenException, Headers, Post, UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { IsNotEmpty, IsString } from "class-validator";
import { randomUUID } from "crypto";
import {
  DomainEvent, SmsRequestedPayload, Topics,
} from "../../../libs/contracts/src/events";
import { database } from "../../../libs/common/src/database";
import { enqueueOutbox } from "../../../libs/common/src/outbox";
import {
  beginIdempotent, completeIdempotent, requestFingerprint,
} from "../../../libs/common/src/idempotency";
import { generateCode, hashCode, verifyCode } from "../../../libs/common/src/otp";
import { buildJwtConfig } from "../../../libs/common/src/oidc";

const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const MAX_REQUESTS_PER_HOUR = 5;

export class RequestOtpDto {
  @IsString() @IsNotEmpty() phone!: string;
}

export class VerifyOtpDto {
  @IsString() @IsNotEmpty() challengeId!: string;
  @IsString() @IsNotEmpty() code!: string;
}

/** Best-effort E.164 normalization so "+91 99999 99999" and "9999999999" resolve to the same patient. */
function normalizePhone(raw: string): string {
  const digits = raw.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return digits;
  return `+91${digits.replace(/^0+/, "")}`;
}

@Controller("auth/patient")
export class PatientAuthController {
  constructor(private readonly jwt: JwtService) {}

  @Post("otp/request")
  async requestOtp(
    @Body() body: RequestOtpDto,
    @Headers("idempotency-key") key: string | undefined,
  ) {
    const phone = normalizePhone(body.phone);

    const client = await database().connect();
    try {
      await client.query("BEGIN");
      const replay = await beginIdempotent<{ challengeId: string }>(
        client, key, requestFingerprint("POST", "/auth/patient/otp/request", body),
      );
      if (replay) { await client.query("COMMIT"); return replay; }

      const recent = await client.query<{ count: string }>(
        "SELECT COUNT(*) FROM otp_challenges WHERE phone = $1 AND created_at > now() - interval '1 hour'",
        [phone],
      );
      if (Number(recent.rows[0].count) >= MAX_REQUESTS_PER_HOUR) {
        throw new ForbiddenException("Too many codes requested for this number. Try again later.");
      }

      // Find-or-create runs the same way whether the phone is new or already
      // registered, so the response never reveals which case it was.
      const existing = await client.query<{ id: string }>("SELECT id FROM users WHERE phone = $1", [phone]);
      let userId = existing.rows[0]?.id;
      if (!userId) {
        userId = randomUUID();
        await client.query(
          "INSERT INTO users (id, phone, roles) VALUES ($1, $2, ARRAY['user']::TEXT[])",
          [userId, phone],
        );
      }

      const challengeId = randomUUID();
      const code = generateCode();
      await client.query(
        "INSERT INTO otp_challenges (id, phone, code_hash, expires_at) VALUES ($1, $2, $3, $4)",
        [challengeId, phone, hashCode(code), new Date(Date.now() + CHALLENGE_TTL_MS)],
      );

      const smsPayload: SmsRequestedPayload = { to: phone, message: `Your Zentinel code is ${code}. It expires in 5 minutes.` };
      const event: DomainEvent<SmsRequestedPayload> = {
        id: randomUUID(), type: Topics.smsRequested, occurredAt: new Date().toISOString(),
        correlationId: randomUUID(), payload: smsPayload,
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

  @Post("otp/verify")
  async verifyOtp(@Body() body: VerifyOtpDto) {
    // Committed immediately (no surrounding transaction), so a thrown rejection
    // below never rolls back the attempts increment.
    const attempted = await database().query<{
      attempts: number; code_hash: string; expires_at: Date; phone: string;
    }>(
      `UPDATE otp_challenges SET attempts = attempts + 1
       WHERE id = $1 AND consumed_at IS NULL
       RETURNING attempts, code_hash, expires_at, phone`,
      [body.challengeId],
    );
    const challenge = attempted.rows[0];
    if (!challenge) throw new UnauthorizedException("Invalid or already-used challenge.");
    if (challenge.attempts > MAX_ATTEMPTS) throw new ForbiddenException("Too many attempts.");
    if (new Date(challenge.expires_at).getTime() < Date.now()) throw new UnauthorizedException("Code expired.");
    if (!verifyCode(challenge.code_hash, body.code)) throw new UnauthorizedException("Incorrect code.");

    const userResult = await database().query<{ id: string; roles: string[] }>(
      "SELECT id, roles FROM users WHERE phone = $1", [challenge.phone],
    );
    const user = userResult.rows[0];
    if (!user) throw new UnauthorizedException("Account no longer exists.");

    await database().query("UPDATE otp_challenges SET consumed_at = NOW() WHERE id = $1", [body.challengeId]);

    const jwtConfig = buildJwtConfig();
    const accessToken = this.jwt.sign(
      { sub: user.id, roles: user.roles },
      { issuer: jwtConfig.issuer, audience: jwtConfig.audience },
    );
    return { accessToken, userId: user.id };
  }
}
