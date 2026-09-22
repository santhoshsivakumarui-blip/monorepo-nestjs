import { Body, Controller, Get, Headers, Post } from "@nestjs/common";
import { IsEmail, IsNotEmpty, IsString } from "class-validator";
import { randomUUID } from "crypto";
import {
  DomainEvent,
  EmailRequestedPayload,
  Topics,
} from "../../../libs/contracts/src/events";
import { database } from "../../../libs/common/src/database";
import { enqueueOutbox } from "../../../libs/common/src/outbox";
import {
  beginIdempotent,
  completeIdempotent,
  requestFingerprint,
} from "../../../libs/common/src/idempotency";

export class CreateEmailDto {
  @IsEmail()
  to!: string;

  @IsString()
  @IsNotEmpty()
  subject!: string;

  @IsString()
  @IsNotEmpty()
  message!: string;
}

@Controller("email")
export class EmailController {
  @Get("health") health() {
    return { status: "ok", service: "email" };
  }

  @Post()
  async enqueue(
    @Body() body: CreateEmailDto,
    @Headers("idempotency-key") key: string | undefined,
  ) {
    const payload: EmailRequestedPayload = {
      to: body.to,
      subject: body.subject,
      message: body.message,
    };
    const event: DomainEvent<EmailRequestedPayload> = {
      id: randomUUID(),
      type: Topics.emailRequested,
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
        requestFingerprint("POST", "/email", body),
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
