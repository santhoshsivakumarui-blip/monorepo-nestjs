import { Module } from '@nestjs/common';
import { SmsController } from './sms.controller';
import { SmsDeliveryController } from './sms-delivery.controller';
@Module({ controllers: [SmsController, SmsDeliveryController] })
export class AppModule {}
