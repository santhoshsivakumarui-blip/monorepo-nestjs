import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationEventsController } from './notification-events.controller';
@Module({ controllers: [NotificationsController, NotificationEventsController] })
export class AppModule {}
