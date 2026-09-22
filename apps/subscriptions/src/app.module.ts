import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { assertAuthConfig, JwtRolesGuard } from '../../../libs/common/src/oidc';
import { SubscriptionsController } from './subscriptions.controller';
import { SubscriptionEventsController } from './subscription-events.controller';

const jwtConfig = assertAuthConfig();

@Module({
  imports: [
    JwtModule.register({
      secret: jwtConfig.secret,
      signOptions: { issuer: jwtConfig.issuer, audience: jwtConfig.audience },
    }),
  ],
  controllers: [SubscriptionsController, SubscriptionEventsController],
  providers: [JwtRolesGuard],
})
export class AppModule {}
