import { Controller, Logger } from "@nestjs/common";
import { Ctx, EventPattern, Payload, RmqContext } from "@nestjs/microservices";
import {
  EmailRequestedPayload,
  Topics,
} from "../../../libs/contracts/src/events";
import { sendEmail } from "../../../libs/common/src/mailer";
import { withRetry } from "../../../libs/common/src/resilience";

/**
 * Consumes its own RabbitMQ queue and delivers via the configured SMTP
 * relay. The queue is manual-ack (noAck: false, see main.ts); a message that
 * still fails after in-process retries is nacked without requeue, which
 * RabbitMQ routes to the queue's dead-letter queue via its configured DLX.
 */
@Controller()
export class EmailDeliveryController {
  private readonly logger = new Logger(EmailDeliveryController.name);

  @EventPattern(Topics.emailRequested)
  async deliver(
    @Payload() payload: EmailRequestedPayload,
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
        sendEmail({
          to: payload.to,
          subject: payload.subject,
          text: payload.message,
        }),
      );
      this.logger.log(`Delivered email to ${payload.to}`);
      channel.ack(originalMsg);
    } catch (error) {
      this.logger.error(
        `Failed to deliver email to ${payload.to} — dead-lettering`,
        error instanceof Error ? error.stack : String(error),
      );
      channel.nack(originalMsg, false, false);
    }
  }
}
