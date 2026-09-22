import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { assertAuthConfig, JwtRolesGuard } from '../../../libs/common/src/oidc';
import { NotificationsController } from './notifications.controller';
import { NotificationEventsController } from './notification-events.controller';
import { NotificationsFeedController } from './notifications-feed.controller';
import { PreferencesController } from './preferences.controller';
import { SosController } from './sos.controller';

const jwtConfig = assertAuthConfig();

@Module({
  imports: [
    JwtModule.register({
      secret: jwtConfig.secret,
      signOptions: { issuer: jwtConfig.issuer, audience: jwtConfig.audience },
    }),
  ],
  controllers: [
    NotificationsController,
    NotificationEventsController,
    NotificationsFeedController,
    PreferencesController,
    SosController,
  ],
  providers: [JwtRolesGuard],
})
export class AppModule {}
