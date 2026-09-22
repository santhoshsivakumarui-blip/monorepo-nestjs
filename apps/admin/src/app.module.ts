import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { assertAuthConfig, JwtRolesGuard } from "../../../libs/common/src/oidc";
import { TenantsController } from "./tenants.controller";
import { HardwareCatalogController } from "./hardware-catalog.controller";
import { AdminUsersController } from "./admin-users.controller";
import { HospitalRegistrationController } from "./hospital-registration.controller";
import { StaffAuthController } from "./staff-auth.controller";
import { StaffController } from "./staff.controller";
import { HospitalSettingsController } from "./hospital-settings.controller";
import { HospitalAuditController } from "./hospital-audit.controller";
import { StaffProfileController } from "./staff-profile.controller";
import { PasswordResetController } from "./password-reset.controller";

const jwtConfig = assertAuthConfig();

@Module({
  imports: [
    JwtModule.register({
      secret: jwtConfig.secret,
      signOptions: { issuer: jwtConfig.issuer, audience: jwtConfig.audience },
    }),
  ],
  controllers: [
    TenantsController,
    HardwareCatalogController,
    AdminUsersController,
    HospitalRegistrationController,
    StaffAuthController,
    StaffController,
    HospitalSettingsController,
    HospitalAuditController,
    StaffProfileController,
    PasswordResetController,
  ],
  providers: [JwtRolesGuard],
})
export class AppModule {}
