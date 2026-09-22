import { Controller, Logger } from "@nestjs/common";
import { Ctx, EventPattern, Payload, RmqContext } from "@nestjs/microservices";
import {
  SmsRequestedPayload,
  Topics,
} from "../../../libs/contracts/src/events";
import { sendSms } from "../../../libs/common/src/sms";
import { withRetry } from "../../../libs/common/src/resilience";

/**
 * Consumes its own RabbitMQ queue and delivers via MSG91. The queue is
 * manual-ack (noAck: false, see main.ts); a message that still fails after
 * in-process retries is nacked without requeue, which RabbitMQ routes to the
 * queue's dead-letter queue via its configured DLX.
 */
@Controller()
export class SmsDeliveryController {
  private readonly logger = new Logger(SmsDeliveryController.name);

  @EventPattern(Topics.smsRequested)
  async deliver(
    @Payload() payload: SmsRequestedPayload,
    @Ctx() context: RmqContext,
  ) {
    const channel = context.getChannelRef();
    const originalMsg = context.getMessage();

    if (!payload?.to || !payload.message) {
      channel.ack(originalMsg);
      return;
    }

    try {
      await withRetry(() =>
        sendSms({ to: payload.to, message: payload.message }),
      );
      this.logger.log(`Delivered SMS to ${payload.to}`);
      channel.ack(originalMsg);
    } catch (error) {
      this.logger.error(
        `Failed to deliver SMS to ${payload.to} — dead-lettering`,
        error instanceof Error ? error.stack : String(error),
      );
      channel.nack(originalMsg, false, false);
    }
  }
}
