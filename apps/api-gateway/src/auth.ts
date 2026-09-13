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

interface JwtUser {
  sub: string;
  roles: string[];
}

const isProduction = process.env.NODE_ENV === "production";
const oauthIssuer = process.env.OAUTH_ISSUER;
const oauthAudience = process.env.OAUTH_AUDIENCE;
const oauthClientId = process.env.OAUTH_CLIENT_ID;
const oidcConfigured = Boolean(oauthIssuer || oauthAudience || oauthClientId);
const jwtConfig = {
  secret: process.env.JWT_SECRET,
  issuer:
    process.env.JWT_ISSUER ?? (isProduction ? undefined : "platform-local"),
  audience:
    process.env.JWT_AUDIENCE ?? (isProduction ? undefined : "platform-api"),
};

const isDevelopmentSecret = (value?: string) =>
  !value || /change-me|development-only|example|placeholder/i.test(value);

async function validateOidcConfiguration(env = process.env) {
  const issuer = env.OAUTH_ISSUER;
  const audience = env.OAUTH_AUDIENCE;
  const clientId = env.OAUTH_CLIENT_ID;

  if (!issuer || !audience || !clientId) {
    throw new Error(
      "OIDC configuration is incomplete. Missing: OAUTH_ISSUER, OAUTH_AUDIENCE, or OAUTH_CLIENT_ID.",
    );
  }

  const discoveryUrl = new URL(
    ".well-known/openid-configuration",
    issuer.endsWith("/") ? issuer : `${issuer}/`,
  );
  const response = await fetch(discoveryUrl.toString());
  if (!response.ok) {
    throw new Error(
      `OIDC discovery request failed for ${issuer}: ${response.status}`,
    );
  }

  const metadata = (await response.json()) as {
    issuer?: string;
    jwks_uri?: string;
  };
  if (metadata.issuer !== issuer) {
    throw new Error(
      `OIDC issuer mismatch: expected ${issuer}, got ${metadata.issuer ?? "unknown"}`,
    );
  }
  if (!metadata.jwks_uri) {
    throw new Error(`OIDC discovery for ${issuer} did not include jwks_uri.`);
  }
}

if (isDevelopmentSecret(jwtConfig.secret)) {
  throw new Error(
    "JWT_SECRET must be set to a non-placeholder value before starting the gateway.",
  );
}

if (oidcConfigured) {
  const missing = [
    !oauthIssuer && "OAUTH_ISSUER",
    !oauthAudience && "OAUTH_AUDIENCE",
    !oauthClientId && "OAUTH_CLIENT_ID",
  ].filter(Boolean) as string[];

  if (missing.length > 0) {
    throw new Error(
      `OIDC configuration is incomplete. Missing: ${missing.join(", ")}.`,
    );
  }
}

if (
  isProduction &&
  !oidcConfigured &&
  (!jwtConfig.issuer || !jwtConfig.audience)
) {
  throw new Error(
    "JWT_ISSUER and JWT_AUDIENCE must be set explicitly in production before starting the gateway.",
  );
}

export { validateOidcConfiguration };

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
      const verified = this.jwt.verify<JwtUser>(raw.slice(7), {
        issuer: jwtConfig.issuer,
        audience: jwtConfig.audience,
      });
      request.user = { ...verified, roles: verified.roles ?? ["user"] };
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
    if (oidcConfigured) {
      throw new UnauthorizedException(
        "OIDC is enabled for this gateway; use the external identity provider to obtain tokens.",
      );
    }

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
