import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { assertAuthConfig, JwtRolesGuard } from '../../../libs/common/src/oidc';
import { VitalsController } from './vitals.controller';
import { VitalsLinkEventsController } from './vitals-link-events.controller';
import { AlertRulesController } from './alert-rules.controller';
import { TriageController } from './triage.controller';
import { MedicationsController } from './medications.controller';
import { FaceScanController } from './face-scan.controller';
import { VitalEventsService } from './vital-events.service';

const jwtConfig = assertAuthConfig();

@Module({
  imports: [
    JwtModule.register({
      secret: jwtConfig.secret,
      signOptions: { issuer: jwtConfig.issuer, audience: jwtConfig.audience },
    }),
  ],
  controllers: [
    VitalsController, VitalsLinkEventsController, AlertRulesController, TriageController,
    MedicationsController, FaceScanController,
  ],
  providers: [JwtRolesGuard, VitalEventsService],
})
export class AppModule {}
