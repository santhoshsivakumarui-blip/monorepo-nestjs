import {
  Body,
  Controller,
  Get,
  Module,
  Post,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { JwtModule, JwtService } from "@nestjs/jwt";
import {
  assertAuthConfig,
  isOidcConfigured,
  JwtRolesGuard,
  Roles,
  validateOidcConfiguration,
} from "../../../libs/common/src/oidc";

const jwtConfig = assertAuthConfig();
const oidcConfigured = isOidcConfigured();

export { validateOidcConfiguration, Roles, JwtRolesGuard };

@Controller("auth")
export class AuthController {
  constructor(private readonly jwt: JwtService) {}

  @Post("token")
  token(
    @Body()
    body: {
      userId: string;
      roles?: string[];
      tenantId?: string;
      branchIds?: string[];
    },
  ) {
    if (oidcConfigured) {
      throw new UnauthorizedException(
        "OIDC is enabled for this gateway; use the external identity provider to obtain tokens.",
      );
    }

    if (!body.userId) throw new UnauthorizedException("userId is required");

    return {
      accessToken: this.jwt.sign(
        {
          sub: body.userId,
          roles: body.roles ?? ["user"],
          ...(body.tenantId ? { tenantId: body.tenantId } : {}),
          ...(body.branchIds ? { branchIds: body.branchIds } : {}),
        },
        {
          issuer: jwtConfig.issuer,
          audience: jwtConfig.audience,
        },
      ),
    };
  }

  @Get("me")
  @UseGuards(JwtRolesGuard)
  me() {
    return { authenticated: true };
  }
}

@Module({
  imports: [
    JwtModule.register({
      secret: jwtConfig.secret,
      signOptions: {
        expiresIn: "15m",
        issuer: jwtConfig.issuer,
        audience: jwtConfig.audience,
      },
    }),
  ],
  controllers: [AuthController],
  providers: [JwtRolesGuard],
  exports: [JwtRolesGuard],
})
export class AuthModule {}
