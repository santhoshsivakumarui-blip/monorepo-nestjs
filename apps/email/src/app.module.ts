import { Module } from '@nestjs/common';
import { EmailController } from './email.controller';
import { EmailDeliveryController } from './email-delivery.controller';
@Module({ controllers: [EmailController, EmailDeliveryController] })
export class AppModule {}
