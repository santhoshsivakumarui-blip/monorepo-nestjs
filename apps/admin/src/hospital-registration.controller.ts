import { Body, Controller, Headers, Post, Req } from "@nestjs/common";
import { IsEmail, IsNotEmpty, IsString, MinLength } from "class-validator";
import { randomUUID } from "crypto";
import {
  DomainEvent, TenantProvisionedPayload, Topics,
} from "../../../libs/contracts/src/events";
import { database, setTenantContext } from "../../../libs/common/src/database";
import { enqueueOutbox } from "../../../libs/common/src/outbox";
import {
  beginIdempotent, completeIdempotent, requestFingerprint,
} from "../../../libs/common/src/idempotency";
import { hashPassword } from "../../../libs/common/src/password";
import { recordAuditEvent } from "./audit";
import { provisionTenant } from "./tenant-provisioning";
import { generateLinkingCode } from "./linking-code";

/**
 * No plan/mode/vaultSecretPath/kmsKeyArn fields here on purpose — every app's
 * ValidationPipe is { whitelist: true, forbidNonWhitelisted: true }, so a caller
 * cannot smuggle those in; self-service registrations always land on starter/pooled.
 */
export class RegisterHospitalDto {
  @IsString() @IsNotEmpty() hospitalName!: string;
  @IsString() @IsNotEmpty() adminName!: string;
  @IsEmail() workEmail!: string;
  @IsString() @IsNotEmpty() mobile!: string;
  @IsString() @MinLength(8) password!: string;
}

interface RequestWithIp { ip: string; }

function slugify(name: string): string {
  const base = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `${base || "hospital"}-${randomUUID().slice(0, 6)}`;
}

@Controller("hospitals")
export class HospitalRegistrationController {
  @Post("register")
  async register(
    @Body() body: RegisterHospitalDto,
    @Headers("idempotency-key") key: string | undefined,
    @Req() req: RequestWithIp,
  ) {
    const tenantId = randomUUID();
    const staffId = randomUUID();
    const slug = slugify(body.hospitalName);

    const payload: TenantProvisionedPayload = {
      tenantId, tenantCode: slug, legalName: body.hospitalName,
      complianceFramework: "unspecified", plan: "starter", mode: "pooled",
      databaseKeys: ["shared_pool_db"], regionAffinity: "unspecified", status: "provisioning",
    };
    const event: DomainEvent<TenantProvisionedPayload> = {
      id: randomUUID(), type: Topics.tenantProvisioned, occurredAt: new Date().toISOString(),
      correlationId: randomUUID(), payload,
    };

    const client = await database().connect();
    try {
      await client.query("BEGIN");
      const replay = await beginIdempotent<TenantProvisionedPayload>(
        client, key, requestFingerprint("POST", "/hospitals/register", body),
      );
      if (replay) { await client.query("COMMIT"); return replay; }

      // tenantId is freshly minted above, not resolved from existing rows — this is
      // the one path where it's known before any tenant-owned row exists yet.
      await setTenantContext(client, tenantId);
      await provisionTenant(client, {
        tenantId, slug, legalName: body.hospitalName, complianceFramework: "unspecified",
        plan: "starter", mode: "pooled", regionAffinity: "unspecified",
        vaultSecretPath: null, kmsKeyArn: null,
      });
      await client.query(
        `INSERT INTO tenant_staff (id, tenant_id, email, password_hash, full_name, role, status)
         VALUES ($1, $2, $3, $4, $5, 'Admin', 'active')`,
        [staffId, tenantId, body.workEmail, hashPassword(body.password), body.adminName],
      );
      await client.query(
        "INSERT INTO hospital_settings (tenant_id, linking_code, emergency_phone) VALUES ($1, $2, $3)",
        [tenantId, generateLinkingCode(), body.mobile],
      );
      await recordAuditEvent(client, {
        adminId: null, actorType: "SELF_SERVICE", action: "TENANT_SELF_REGISTERED",
        targetTenantId: tenantId, ipAddress: req.ip, payload,
      });
      await enqueueOutbox(client, event);
      await completeIdempotent(client, key!, payload);
      await client.query("COMMIT");
      return payload;
    } catch (error) {
      await client.query("ROLLBACK"); throw error;
    } finally { client.release(); }
  }
}
