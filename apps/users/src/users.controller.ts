import { Body, Controller, Get, Headers, Post } from "@nestjs/common";
import { IsEmail, IsNotEmpty } from "class-validator";
import { randomUUID } from "crypto";
import {
  DomainEvent,
  Topics,
  UserCreatedPayload,
} from "../../../libs/contracts/src/events";
import { database } from "../../../libs/common/src/database";
import { enqueueOutbox } from "../../../libs/common/src/outbox";
import {
  beginIdempotent,
  completeIdempotent,
  requestFingerprint,
} from "../../../libs/common/src/idempotency";

export class CreateUserDto {
  @IsEmail()
  @IsNotEmpty()
  email!: string;
}

@Controller("users")
export class UsersController {
  @Get("health") health() {
    return { status: "ok", service: "users" };
  }

  @Post()
  async create(
    @Body() body: CreateUserDto,
    @Headers("idempotency-key") key: string | undefined,
  ): Promise<UserCreatedPayload> {
    const payload = { userId: randomUUID(), email: body.email };
    const event: DomainEvent<UserCreatedPayload> = {
      id: randomUUID(),
      type: Topics.userCreated,
      occurredAt: new Date().toISOString(),
      correlationId: randomUUID(),
      payload,
    };
    const client = await database().connect();
    try {
      await client.query("BEGIN");
      const replay = await beginIdempotent<UserCreatedPayload>(
        client,
        key,
        requestFingerprint("POST", "/users", body),
      );
      if (replay) {
        await client.query("COMMIT");
        return replay;
      }
      await client.query("INSERT INTO users (id, email) VALUES ($1, $2)", [
        payload.userId,
        payload.email,
      ]);
      await enqueueOutbox(client, event);
      await completeIdempotent(client, key!, payload);
      await client.query("COMMIT");
      return payload;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
