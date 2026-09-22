import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { assertAuthConfig, JwtRolesGuard } from '../../../libs/common/src/oidc';
import { UsersController } from './users.controller';
import { HospitalLinkController } from './hospital-link.controller';
import { PatientAuthController } from './patient-auth.controller';
import { PatientProfileController } from './patient-profile.controller';
import { RosterController } from './roster.controller';
import { LinkRequestsController } from './link-requests.controller';
import { TreatingClinicianController } from './treating-clinician.controller';
import { RevokeAllLinksController } from './revoke-all-links.controller';
import { AbhaController } from './abha.controller';

const jwtConfig = assertAuthConfig();

@Module({
  imports: [
    JwtModule.register({
      secret: jwtConfig.secret,
      signOptions: { issuer: jwtConfig.issuer, audience: jwtConfig.audience },
    }),
  ],
  controllers: [
    UsersController,
    HospitalLinkController,
    PatientAuthController,
    PatientProfileController,
    RosterController,
    LinkRequestsController,
    TreatingClinicianController,
    RevokeAllLinksController,
    AbhaController,
  ],
  providers: [JwtRolesGuard],
})
export class AppModule {}
