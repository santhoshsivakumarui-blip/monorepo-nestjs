import { Body, Controller, Get, Headers, Post } from "@nestjs/common";
import { IsNotEmpty, IsString } from "class-validator";
import { randomUUID } from "crypto";
import { database } from "../../../libs/common/src/database";
import { enqueueOutbox } from "../../../libs/common/src/outbox";
import {
  beginIdempotent,
  completeIdempotent,
  requestFingerprint,
} from "../../../libs/common/src/idempotency";
import { Topics } from "../../../libs/contracts/src/events";

export class CreateNotificationDto {
  @IsString()
  @IsNotEmpty()
  recipient!: string;

  @IsString()
  @IsNotEmpty()
  message!: string;
}

@Controller("notifications")
export class NotificationsController {
  @Get("health") health() {
    return { status: "ok", service: "notifications" };
  }

  @Post()
  async enqueue(
    @Body() body: CreateNotificationDto,
    @Headers("idempotency-key") key: string | undefined,
  ) {
    const event = {
      id: randomUUID(),
      type: Topics.notificationsRequested,
      occurredAt: new Date().toISOString(),
      correlationId: randomUUID(),
      payload: body,
    };
    const client = await database().connect();
    const response = { accepted: true, id: event.id };
    try {
      await client.query("BEGIN");
      const replay = await beginIdempotent<typeof response>(
        client,
        key,
        requestFingerprint("POST", "/notifications", body),
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
