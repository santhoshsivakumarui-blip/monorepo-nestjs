import { Body, Controller, Get, Headers, Post } from "@nestjs/common";
import { IsNotEmpty, IsNumber, IsString, Min } from "class-validator";
import { randomUUID } from "crypto";
import {
  DomainEvent,
  OrderCreatedPayload,
  Topics,
} from "../../../libs/contracts/src/events";
import { database } from "../../../libs/common/src/database";
import { enqueueOutbox } from "../../../libs/common/src/outbox";
import {
  beginIdempotent,
  completeIdempotent,
  requestFingerprint,
} from "../../../libs/common/src/idempotency";

export class CreateOrderDto {
  @IsString()
  @IsNotEmpty()
  userId!: string;

  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  total!: number;
}

@Controller("orders")
export class OrdersController {
  @Get("health") health() {
    return { status: "ok", service: "orders" };
  }

  @Post()
  async create(
    @Body() body: CreateOrderDto,
    @Headers("idempotency-key") key: string | undefined,
  ): Promise<OrderCreatedPayload> {
    const payload = {
      orderId: randomUUID(),
      userId: body.userId,
      total: body.total,
    };
    const event: DomainEvent<OrderCreatedPayload> = {
      id: randomUUID(),
      type: Topics.orderCreated,
      occurredAt: new Date().toISOString(),
      correlationId: randomUUID(),
      payload,
    };
    const client = await database().connect();
    try {
      await client.query("BEGIN");
      const replay = await beginIdempotent<OrderCreatedPayload>(
        client,
        key,
        requestFingerprint("POST", "/orders", body),
      );
      if (replay) {
        await client.query("COMMIT");
        return replay;
      }
      await client.query(
        "INSERT INTO orders (id, user_id, total) VALUES ($1, $2, $3)",
        [payload.orderId, payload.userId, payload.total],
      );
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
