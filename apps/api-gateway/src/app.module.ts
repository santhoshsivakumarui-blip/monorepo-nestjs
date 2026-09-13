import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './auth';
import { HealthController } from './health.controller';
import { MetricsController } from './metrics.controller';
import { ServicesController } from './services.controller';

@Module({ imports: [ConfigModule.forRoot({ isGlobal: true }), ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]), AuthModule], controllers: [HealthController, MetricsController, ServicesController] })
export class AppModule {}
