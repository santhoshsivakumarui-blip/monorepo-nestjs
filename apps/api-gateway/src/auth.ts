import {
  Body,
  Controller,
  Get,
  Injectable,
  Module,
  Post,
  SetMetadata,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { CanActivate, ExecutionContext } from "@nestjs/common";
import { JwtModule, JwtService } from "@nestjs/jwt";

const jwtConfig = {
  secret: process.env.JWT_SECRET,
  issuer: process.env.JWT_ISSUER ?? "platform-local",
  audience: process.env.JWT_AUDIENCE ?? "platform-api",
};

const isDevelopmentSecret = (value?: string) =>
  !value || /change-me|development-only|example|placeholder/i.test(value);

if (isDevelopmentSecret(jwtConfig.secret)) {
  throw new Error(
    "JWT_SECRET must be set to a non-placeholder value before starting the gateway.",
  );
}

export const Roles = (...roles: string[]) => SetMetadata("roles", roles);

@Injectable()
export class JwtRolesGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | undefined>;
      user?: { roles: string[] };
    }>();
    const raw = request.headers.authorization;
    if (!raw?.startsWith("Bearer ")) throw new UnauthorizedException();

    try {
      request.user = this.jwt.verify(raw.slice(7), {
        issuer: jwtConfig.issuer,
        audience: jwtConfig.audience,
      });
      return true;
    } catch {
      throw new UnauthorizedException("Invalid or expired token.");
    }
  }
}

@Controller("auth")
export class AuthController {
  constructor(private readonly jwt: JwtService) {}

  @Post("token")
  token(@Body() body: { userId: string; roles?: string[] }) {
    if (!body.userId) throw new UnauthorizedException("userId is required");

    return {
      accessToken: this.jwt.sign(
        { sub: body.userId, roles: body.roles ?? ["user"] },
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
