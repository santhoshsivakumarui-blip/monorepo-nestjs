import {
  BadRequestException, Body, Controller, ForbiddenException, Get, Headers, Param, Post, Query, Req, UseGuards,
} from "@nestjs/common";
import { IsIn, IsNotEmpty, IsNumber, IsOptional, IsString, Min } from "class-validator";
import { randomUUID } from "crypto";
import {
  DeviceSubscriptionActivatedPayload, DeviceSubscriptionCancelledPayload, DomainEvent, Topics,
} from "../../../libs/contracts/src/events";
import { database, queryAsTenant, setTenantContext } from "../../../libs/common/src/database";
import { enqueueOutbox } from "../../../libs/common/src/outbox";
import {
  beginIdempotent, completeIdempotent, requestFingerprint,
} from "../../../libs/common/src/idempotency";
import { JwtRolesGuard } from "../../../libs/common/src/oidc";

type BillingCycle = "monthly" | "annual";

export class CreateSubscriptionDto {
  @IsString() @IsNotEmpty() userId!: string;
  @IsString() @IsNotEmpty() deviceSku!: string;
  @IsString() @IsNotEmpty() deviceLabel!: string;
  @IsIn(["monthly", "annual"]) billingCycle!: BillingCycle;
  @IsNumber({ allowNaN: false, allowInfinity: false }) @Min(0) priceCents!: number;
  @IsOptional() @IsString() currency?: string;
}

interface AuthenticatedRequest { user?: { sub: string; tenantId?: string }; }

/** Computed once at creation; there is no renewal scheduler yet, so this never rolls forward automatically. */
export function computeCurrentPeriodEnd(billingCycle: BillingCycle, from = new Date()): Date {
  const end = new Date(from);
  if (billingCycle === "monthly") end.setMonth(end.getMonth() + 1);
  else end.setFullYear(end.getFullYear() + 1);
  return end;
}

@Controller("subscriptions")
export class SubscriptionsController {
  @Get("health") health() { return { status: "ok", service: "subscriptions" }; }

  @Post()
  @UseGuards(JwtRolesGuard)
  async create(
    @Body() body: CreateSubscriptionDto,
    @Headers("idempotency-key") key: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    if (req.user!.sub !== body.userId) {
      throw new ForbiddenException("Cannot create a subscription for another user.");
    }

    const subscriptionId = randomUUID();
    const currency = body.currency ?? "INR";
    const currentPeriodEnd = computeCurrentPeriodEnd(body.billingCycle);

    const payload: DeviceSubscriptionActivatedPayload = {
      subscriptionId, userId: body.userId, deviceSku: body.deviceSku,
      billingCycle: body.billingCycle, priceCents: body.priceCents, currency, status: "active",
    };
    const event: DomainEvent<DeviceSubscriptionActivatedPayload> = {
      id: randomUUID(), type: Topics.deviceSubscriptionActivated, occurredAt: new Date().toISOString(),
      correlationId: randomUUID(), payload,
    };

    const client = await database().connect();
    try {
      await client.query("BEGIN");
      const replay = await beginIdempotent<DeviceSubscriptionActivatedPayload>(
        client, key, requestFingerprint("POST", "/subscriptions", body),
      );
      if (replay) { await client.query("COMMIT"); return replay; }

      // Same-DB read model of users_db's link state — lets a subscription bought
      // AFTER a hospital link already exists still resolve linked_tenant_id correctly.
      const cache = await client.query<{ tenant_id: string }>(
        "SELECT tenant_id FROM patient_hospital_link_cache WHERE user_id = $1", [body.userId],
      );
      const linkedTenantId = cache.rows[0]?.tenant_id ?? null;
      if (linkedTenantId) await setTenantContext(client, linkedTenantId);

      await client.query(
        `INSERT INTO device_subscriptions
           (id, user_id, device_sku, device_label, billing_cycle, price_cents, currency, current_period_end, linked_tenant_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [subscriptionId, body.userId, body.deviceSku, body.deviceLabel, body.billingCycle,
         body.priceCents, currency, currentPeriodEnd.toISOString(), linkedTenantId],
      );
      await enqueueOutbox(client, event);
      await completeIdempotent(client, key!, payload);
      await client.query("COMMIT");
      return payload;
    } catch (error) {
      await client.query("ROLLBACK"); throw error;
    } finally { client.release(); }
  }

  @Get("mine")
  @UseGuards(JwtRolesGuard)
  async mine(@Req() req: AuthenticatedRequest) {
    // Deliberately not tenant-scoped: a patient's own subscriptions can span
    // more than one linked_tenant_id over time. See vitals.controller.ts's
    // accessLogMine for the same pattern and its RLS-enforcement caveat.
    const { rows } = await database().query(
      `SELECT id, user_id, device_sku, device_label, billing_cycle, price_cents, currency, status,
              started_at, current_period_end, cancelled_at, linked_tenant_id
       FROM device_subscriptions WHERE user_id = $1 ORDER BY created_at DESC`,
      [req.user!.sub],
    );
    return rows;
  }

  @Post(":id/cancel")
  @UseGuards(JwtRolesGuard)
  async cancel(
    @Param("id") id: string,
    @Headers("idempotency-key") key: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    const client = await database().connect();
    try {
      await client.query("BEGIN");
      // The route has a dynamic :id segment, so the actual id (not the literal
      // template) must be interpolated into the fingerprint — otherwise two
      // different subscriptions cancelled with the same Idempotency-Key would collide.
      const replay = await beginIdempotent<DeviceSubscriptionCancelledPayload>(
        client, key, requestFingerprint("POST", `/subscriptions/${id}/cancel`, {}),
      );
      if (replay) { await client.query("COMMIT"); return replay; }

      const existing = await client.query<{ user_id: string }>(
        "SELECT user_id FROM device_subscriptions WHERE id = $1 FOR UPDATE", [id],
      );
      const subscription = existing.rows[0];
      if (!subscription) throw new BadRequestException("Subscription not found.");
      if (subscription.user_id !== req.user!.sub) {
        throw new ForbiddenException("Cannot cancel another user's subscription.");
      }

      await client.query(
        "UPDATE device_subscriptions SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW() WHERE id = $1",
        [id],
      );
      const payload: DeviceSubscriptionCancelledPayload = { subscriptionId: id, userId: subscription.user_id };
      const event: DomainEvent<DeviceSubscriptionCancelledPayload> = {
        id: randomUUID(), type: Topics.deviceSubscriptionCancelled, occurredAt: new Date().toISOString(),
        correlationId: randomUUID(), payload,
      };
      await enqueueOutbox(client, event);
      await completeIdempotent(client, key!, payload);
      await client.query("COMMIT");
      return payload;
    } catch (error) {
      await client.query("ROLLBACK"); throw error;
    } finally { client.release(); }
  }

  /** Hospital-visibility view: patients linked to this tenant only. Always self-pay — never a billing handoff. */
  @Get()
  @UseGuards(JwtRolesGuard)
  async byTenant(@Query("tenantId") tenantId: string | undefined, @Req() req: AuthenticatedRequest) {
    if (!tenantId) throw new BadRequestException("tenantId query parameter is required.");
    if (req.user!.tenantId && req.user!.tenantId !== tenantId) {
      throw new ForbiddenException("Cannot view another tenant's subscriptions.");
    }
    const { rows } = await queryAsTenant(
      tenantId,
      `SELECT id, user_id, device_sku, device_label, billing_cycle, price_cents, currency, status,
              started_at, current_period_end, cancelled_at, linked_tenant_id
       FROM device_subscriptions WHERE linked_tenant_id = $1 ORDER BY created_at DESC`,
      [tenantId],
    );
    return rows.map((row) => ({ ...row, payer: "patient" as const }));
  }
}
