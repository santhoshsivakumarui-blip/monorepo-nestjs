import { Controller, Logger } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import { randomUUID } from 'crypto';
import { NotificationRequestedPayload, Topics, UserCreatedPayload } from '../../../libs/contracts/src/events';
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

  /** The consumer POST /notifications's own producer role has always been missing — see notifications.controller.ts. */
  @EventPattern(Topics.notificationsRequested)
  async notificationsRequested(@Payload() message: { value?: NotificationRequestedPayload; key?: string }) {
    const id = message.key?.toString();
    const payload = message.value;
    if (!id || !payload) return;

    const client = await database().connect();
    try {
      await client.query('BEGIN');
      const inserted = await client.query('INSERT INTO inbox_events (id) VALUES ($1) ON CONFLICT DO NOTHING', [id]);
      if (!inserted.rowCount) { await client.query('COMMIT'); return; }

      await client.query(
        'INSERT INTO notifications_feed (id, recipient, category, title, message) VALUES ($1, $2, $3, $4, $5)',
        [randomUUID(), payload.recipient, payload.category ?? 'system', payload.title ?? null, payload.message],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK'); throw error;
    } finally { client.release(); }
  }
}
