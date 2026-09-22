import { Body, Controller, Get, Headers, Post } from "@nestjs/common";
import { IsNotEmpty, IsString } from "class-validator";
import { randomUUID } from "crypto";
import {
  DomainEvent,
  SmsRequestedPayload,
  Topics,
} from "../../../libs/contracts/src/events";
import { database } from "../../../libs/common/src/database";
import { enqueueOutbox } from "../../../libs/common/src/outbox";
import {
  beginIdempotent,
  completeIdempotent,
  requestFingerprint,
} from "../../../libs/common/src/idempotency";

export class CreateSmsDto {
  @IsString()
  @IsNotEmpty()
  to!: string;

  @IsString()
  @IsNotEmpty()
  message!: string;
}

@Controller("sms")
export class SmsController {
  @Get("health") health() {
    return { status: "ok", service: "sms" };
  }

  @Post()
  async enqueue(
    @Body() body: CreateSmsDto,
    @Headers("idempotency-key") key: string | undefined,
  ) {
    const payload: SmsRequestedPayload = { to: body.to, message: body.message };
    const event: DomainEvent<SmsRequestedPayload> = {
      id: randomUUID(),
      type: Topics.smsRequested,
      occurredAt: new Date().toISOString(),
      correlationId: randomUUID(),
      payload,
    };
    const response = { accepted: true, id: event.id };
    const client = await database().connect();
    try {
      await client.query("BEGIN");
      const replay = await beginIdempotent<typeof response>(
        client,
        key,
        requestFingerprint("POST", "/sms", body),
      );
      if (replay) {
        await client.query("COMMIT");
        return replay;
      }
      await enqueueOutbox(client, event);
      await completeIdempotent(client, key!, response);
      await client.query("COMMIT");
      return response;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
