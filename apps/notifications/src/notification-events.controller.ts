import { Controller, Logger } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import { Topics, UserCreatedPayload } from '../../../libs/contracts/src/events';
import { database } from '../../../libs/common/src/database';

@Controller()
export class NotificationEventsController {
  private readonly logger = new Logger(NotificationEventsController.name);
  @EventPattern(Topics.userCreated)
  async userCreated(@Payload() message: { value?: UserCreatedPayload; key?: string }) {
    const id = message.key?.toString(); if (!id) return;
    const result = await database().query('INSERT INTO inbox_events (id) VALUES ($1) ON CONFLICT DO NOTHING', [id]);
    if (result.rowCount) this.logger.log(`User created event accepted for ${message.value?.email}`);
  }
}
